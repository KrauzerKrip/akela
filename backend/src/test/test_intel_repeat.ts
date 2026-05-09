/**
 * Repeat IntelAgent runs on one manifest with shared map extraction — compares variability across attempts.
 *
 * Usage:
 *   SESSION_DB_URL=... bun run src/test/test_intel_repeat.ts .data/params_civs.json --runs 5 -o .data/test/intel_repeat_kavala
 *
 * Optional: --keywords "hill,ridge,overwatch,mrap" — substring hits counted case-insensitively in report + unit labels.
 */

import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { DatabaseSessionService } from "@google/adk";
import { IntelAgent, Image, Intel } from "../agent";
import { GameMap } from "../geography";
import { SimpleIntelPromptFormatter } from "../format";
import { Session } from "../session";
import type { StructuredIntelResult } from "../intel/models";
import { loadIntelTestManifest } from "./test_intel_agent";

function usage(): void {
    console.error(
        "Usage: bun run src/test/test_intel_repeat.ts <manifest.json> --runs <n> -o <output_dir> [--keywords \"a,b,c\"]",
    );
}

function structuredIntelToJson(result: StructuredIntelResult): Record<string, unknown> {
    return {
        report: result.report,
        marks: result.marks,
        marksJson: result.marksJson,
        ...(result.visualization !== undefined ? { visualization: result.visualization } : {}),
    };
}

function normalizeLabel(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function summarizeRun(result: StructuredIntelResult): {
    unitCount: number;
    areaCount: number;
    labelsNorm: string[];
} {
    const labels = result.marks.units
        .map((u) => u.label ?? u.type)
        .filter((x): x is string => typeof x === "string" && x.length > 0);
    return {
        unitCount: result.marks.units.length,
        areaCount: result.marks.areas.length,
        labelsNorm: [...new Set(labels.map(normalizeLabel))].sort(),
    };
}

function keywordHits(textBlob: string, keywords: string[]): Record<string, boolean> {
    const lower = textBlob.toLowerCase();
    const out: Record<string, boolean> = {};
    for (const k of keywords) {
        const kk = k.trim().toLowerCase();
        if (kk.length === 0) continue;
        out[kk] = lower.includes(kk);
    }
    return out;
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            o: { type: "string" },
            runs: { type: "string", default: "3" },
            keywords: { type: "string" },
        },
        allowPositionals: true,
    });

    if (positionals.length < 1 || !values.o) {
        usage();
        process.exit(1);
    }

    const manifestFile = path.resolve(positionals[0]!);
    const outDir = path.resolve(values.o as string);
    const runs = Math.max(1, Number.parseInt(values.runs ?? "3", 10) || 3);
    const keywordsRaw = values.keywords as string | undefined;
    const keywords = keywordsRaw
        ? keywordsRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    if (!fs.existsSync(manifestFile)) {
        console.error(`Manifest file not found: ${manifestFile}`);
        process.exit(1);
    }

    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    } catch (e) {
        console.error(`Failed to parse JSON: ${manifestFile}`, e);
        process.exit(1);
    }

    const payload = loadIntelTestManifest(raw, manifestFile);

    const dbUrl = process.env.SESSION_DB_URL;
    if (!dbUrl) {
        console.error("SESSION_DB_URL environment variable is required.");
        process.exit(1);
    }

    fs.mkdirSync(outDir, { recursive: true });

    const batchId = new Date().toISOString().replace(/:/g, "-") + "-" + uuidv4().slice(0, 8);
    const workRoot = path.join(outDir, `_work_${batchId}`);
    fs.mkdirSync(path.join(workRoot, "areas"), { recursive: true });
    fs.mkdirSync(path.join(workRoot, "intel"), { recursive: true });

    const session = {
        getId: () => `intel-repeat-${batchId}`,
        getDirectory: () => workRoot,
        getAreasDirectory: () => path.join(workRoot, "areas"),
        getPlanningDirectory: () => path.join(workRoot, "planning"),
        getIntelDirectory: () => path.join(workRoot, "intel"),
    } as Session;

    const sessionService = new DatabaseSessionService(dbUrl);
    await sessionService.init();

    const gameMap = new GameMap(session);
    console.log(
        `Extracting map area (${payload.area.x1}, ${payload.area.y1}) → (${payload.area.x2}, ${payload.area.y2}) once…`,
    );
    const gameMapArea = await gameMap.extractArea(
        { x: payload.area.x1, y: payload.area.y1 },
        { x: payload.area.x2, y: payload.area.y2 },
    );

    const intel: Intel = {
        images: (payload.intel.photos ?? [])
            .filter((photoPath): photoPath is string => typeof photoPath === "string" && fs.existsSync(photoPath))
            .map((photoPath) => new Image(photoPath)),
        observations: payload.intel.observations ?? [],
    };

    const missingPhotos = (payload.intel.photos ?? []).filter(
        (p) => typeof p === "string" && !fs.existsSync(p),
    );
    if (missingPhotos.length > 0) {
        console.warn("Skipping missing photo paths:", missingPhotos);
    }

    const agent = new IntelAgent(new SimpleIntelPromptFormatter(), sessionService, session);
    console.log(
        `Repeating IntelAgent ${runs} times with ${intel.images.length} image(s), outputs under ${outDir}`,
    );

    const runSummaries: Record<string, unknown>[] = [];
    const labelCounts = new Map<string, number>();

    for (let i = 0; i < runs; i++) {
        console.log(`\n--- Run ${i + 1}/${runs} ---`);
        const result = await agent.analyze(intel, gameMapArea);
        const outfile = path.join(outDir, `run_${String(i).padStart(3, "0")}.json`);
        fs.writeFileSync(outfile, JSON.stringify(structuredIntelToJson(result), null, 2));
        console.log(`Wrote ${outfile}`);

        const sum = summarizeRun(result);
        for (const lb of sum.labelsNorm) {
            labelCounts.set(lb, (labelCounts.get(lb) ?? 0) + 1);
        }

        const labelsJoined = result.marks.units.map((u) => u.label ?? "").join(" ");
        const blob = `${result.report}\n${labelsJoined}`;
        const kw = keywords.length > 0 ? keywordHits(blob, keywords) : {};

        runSummaries.push({
            index: i,
            outputPath: outfile,
            unitCount: sum.unitCount,
            areaCount: sum.areaCount,
            labelsNorm: sum.labelsNorm,
            ...(keywords.length > 0 ? { keywordHits: kw } : {}),
        });
    }

    const summary = {
        manifest: manifestFile,
        batchId,
        runs,
        imageCount: intel.images.length,
        observationCount: intel.observations.length,
        ...(keywords.length > 0 ? { keywords } : {}),
        unitCountRange: {
            min: Math.min(...runSummaries.map((r) => r.unitCount as number)),
            max: Math.max(...runSummaries.map((r) => r.unitCount as number)),
        },
        labelsSeenAcrossRuns: [...labelCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => ({ label, runCount: count })),
        runsDetail: runSummaries,
    };

    fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(`\nSummary written to ${path.join(outDir, "summary.json")}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
