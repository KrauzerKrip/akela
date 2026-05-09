/**
 * Staged Intel pipeline helpers: batched visual extraction → merge → final georeferenced marks.
 * Keeps public StructuredIntelResult shape unchanged for PlanAgent.
 */

import path from "path";
import { z } from "zod";

/** Default batch size for UAV photo extraction passes (Flash-friendly). */
export const DEFAULT_INTEL_BATCH_SIZE = 6;

export function intelBatchSizeFromEnv(): number {
    const raw = process.env.AKELA_INTEL_BATCH_SIZE;
    if (!raw) return DEFAULT_INTEL_BATCH_SIZE;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 16) return DEFAULT_INTEL_BATCH_SIZE;
    return n;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

export function photoLabel(globalIndex1Based: number, imagePath: string): string {
    const base = path.basename(imagePath);
    return `Photo ${globalIndex1Based}: ${base}`;
}

export function mimeTypeForImagePath(imagePath: string): string {
    const ext = path.extname(imagePath).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    return "image/jpeg";
}

const confidenceSchema = z.enum(["high", "medium", "low"]);

const extractionFindingSchema = z.object({
    description: z.string().min(1),
    category: z.string().optional(),
    confidence: confidenceSchema,
    sourcePhotoLabels: z.array(z.string().min(1)).min(1),
    /** Qualitative placement within the frame / terrain cues when coords are absent or unclear. */
    roughLocationHint: z.string().optional(),
    /**
     * Transcribe any legible coordinate/grid/HUD readouts from the imagery (e.g. GRID lines, numeric X/Y,
     * six-digit map hints). Note if labels indicate UAV vs cursor/target when discernible.
     * Omit if nothing readable — do not invent numbers.
     */
    coordinateReadouts: z.string().optional(),
});

export const extractionBatchSchema = z.object({
    findings: z.array(extractionFindingSchema),
});

export type ExtractionBatch = z.infer<typeof extractionBatchSchema>;

const mergedFindingSchema = z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    confidence: confidenceSchema,
    sourcePhotoLabels: z.array(z.string().min(1)).min(1),
    mergeNotes: z.string().optional(),
    roughLocationHint: z.string().optional(),
    /** Combined transcription from merged source findings; omit if none. */
    coordinateReadouts: z.string().optional(),
});

export const mergePassSchema = z.object({
    mergedFindings: z.array(mergedFindingSchema),
});

export type MergePassResult = z.infer<typeof mergePassSchema>;

export function extractJsonObject(text: string): string {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) return text.slice(first, last + 1).trim();
    return text.trim();
}

export function buildMergeUserPayload(batchResults: { batchIndex: number; findings: ExtractionBatch["findings"] }[]): string {
    return JSON.stringify({ batchFindings: batchResults }, null, 2);
}
