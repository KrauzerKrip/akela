import { parseArgs } from "util";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { DatabaseSessionService } from "@google/adk";
import { IntelAgent, Image, Intel } from "../agent";
import { GameMap } from "../geography";
import { SimpleIntelPromptFormatter } from "../format";
import { Session } from "../session";
import type { SessionInitializePayload } from "../session_initializer";
import type { StructuredIntelResult } from "../intel/models";
import { IntelVisualizer } from "../intel/visualization";

function usage(): void {
    console.error(
        "Usage: bun run src/test/test_intel_agent.ts <manifest_or_params.json> -o <output.json>",
    );
}

function loadPayload(raw: unknown, manifestPath: string): SessionInitializePayload {
    let base: unknown = raw;
    if (
        raw &&
        typeof raw === "object" &&
        "intelInput" in raw &&
        (raw as { intelInput?: unknown }).intelInput &&
        typeof (raw as { intelInput: unknown }).intelInput === "object"
    ) {
        base = (raw as { intelInput: Record<string, unknown> }).intelInput;
    }

    const payload = base as SessionInitializePayload;
    const area = payload.area;
    if (
        !area
        || typeof area.x1 !== "number"
        || typeof area.y1 !== "number"
        || typeof area.x2 !== "number"
        || typeof area.y2 !== "number"
    ) {
        throw new Error("Manifest must include area with numeric x1, y1, x2, y2.");
    }

    const manifestDir = path.dirname(path.resolve(manifestPath));
    const photos = payload.intel?.photos;
    if (Array.isArray(photos)) {
        payload.intel = {
            ...payload.intel,
            photos: photos.map((p) =>
                typeof p === "string" && !path.isAbsolute(p) ? path.resolve(manifestDir, p) : p,
            ),
        };
    }

    return payload;
}

function structuredIntelToJson(result: StructuredIntelResult): Record<string, unknown> {
    return {
        report: result.report,
        marks: result.marks,
        marksJson: result.marksJson,
        ...(result.visualization !== undefined ? { visualization: result.visualization } : {}),
    };
}

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        args: process.argv.slice(2),
        options: {
            o: { type: "string" },
        },
        allowPositionals: true,
    });

    if (positionals.length < 1 || !values.o) {
        usage();
        process.exit(1);
    }

    const manifestFile = path.resolve(positionals[0]!);
    const outputFile = path.resolve(values.o);

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

    const payload = loadPayload(raw, manifestFile);

    const dbUrl = process.env.SESSION_DB_URL;
    if (!dbUrl) {
        console.error("SESSION_DB_URL environment variable is required.");
        process.exit(1);
    }

    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const runId = `${timestamp}-${uuidv4()}`;
    const workRoot = path.join(process.cwd(), ".data", "test", "intel-agent-runs", runId);
    fs.mkdirSync(path.join(workRoot, "areas"), { recursive: true });
    fs.mkdirSync(path.join(workRoot, "intel"), { recursive: true });

    const session = {
        getId: () => `intel-test-${runId}`,
        getDirectory: () => workRoot,
        getAreasDirectory: () => path.join(workRoot, "areas"),
        getPlanningDirectory: () => path.join(workRoot, "planning"),
        getIntelDirectory: () => path.join(workRoot, "intel"),
    } as Session;

    const sessionService = new DatabaseSessionService(dbUrl);
    await sessionService.init();

    const gameMap = new GameMap(session);
    console.log(
        `Extracting map area (${payload.area.x1}, ${payload.area.y1}) → (${payload.area.x2}, ${payload.area.y2})…`,
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
    console.log(`Running IntelAgent with ${intel.images.length} image(s) and ${intel.observations.length} observation(s).`);

    const result = await agent.analyze(intel, gameMapArea);

    const outDir = path.dirname(outputFile);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const stem = path.basename(outputFile, path.extname(outputFile));
    if (result.marks.units.length > 0 || result.marks.areas.length > 0) {
        try {
            const visualizer = new IntelVisualizer(session);
            const visualization = await visualizer.visualize(gameMapArea, result.marks, [
                "primitives",
                "satellite",
            ]);
            const primDest = path.join(outDir, `${stem}_marks_primitives.png`);
            const satDest = path.join(outDir, `${stem}_marks_satellite.png`);
            fs.copyFileSync(visualization.getImagePath("primitives"), primDest);
            fs.copyFileSync(visualization.getImagePath("satellite"), satDest);
            result.visualization = {
                primitivesPath: primDest,
                satellitePath: satDest,
            };
            console.log(`Marks maps written:\n  ${primDest}\n  ${satDest}`);
        } catch (error) {
            console.warn("Failed to render intel marks maps. JSON will omit visualization paths.", error);
        }
    }

    fs.writeFileSync(outputFile, JSON.stringify(structuredIntelToJson(result), null, 2));
    console.log(`Finished. Structured intel written to ${outputFile}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
