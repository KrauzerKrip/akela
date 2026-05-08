import type { Point } from "../geography";
import { z } from "zod";

/**
 * Basenames of SVG files under backend/resources/icons/ (without .svg).
 * Keep this list aligned with files on disk.
 */
export const INTEL_UNIT_TYPES = [
    "civ_civilian",
    "civ_emergency_medical_operation",
    "civ_government_organization",
    "civ_organization_or_group",
    "hostile_air_defense",
    "hostile_ammunition_cache_not_applicable",
    "hostile_anti_tank",
    "hostile_armored_anti_tank",
    "hostile_armored_infantry",
    "hostile_armor_mechanized",
    "hostile_combined_arms",
    "hostile_field_artillery",
    "hostile_headquarters",
    "hostile_infantry",
    "hostile_infantry_fighting_vehicle",
    "hostile_maintenance",
    "hostile_military_civilian_not_applicable",
    "hostile_mortar",
    "hostile_motorized_anti_tank",
    "hostile_motorized_infantry",
    "hostile_not_applicable",
    "hostile_ordnance",
    "hostile_petroleum_oil_and_lubricants",
    "hostile_reconnaissance_cavalry_scout",
    "hostile_sniper",
    "hostile_supply",
    "hostile_task_force",
    "hostile_task_force_headquarters",
    "hostile_transportation",
    "hostile_wheeled_cross_country",
    "unknown",
] as const;

export type IntelUnitType = (typeof INTEL_UNIT_TYPES)[number];

export interface IntelUnit {
    /** Optional stable id for correlation with other artifacts */
    id?: string;
    type: IntelUnitType;
    /** Arma world X/Y (meters), same convention as plan visualization */
    position: Point;
    label?: string;
}

export interface IntelAreaHighlight {
    /** At least three vertices; first vertex is repeated implicitly when closing the polygon */
    vertices: Point[];
    label?: string;
}

export interface IntelMapOverlay {
    units: IntelUnit[];
    areas: IntelAreaHighlight[];
}

export interface StructuredIntelResultVisualization {
    primitivesPath?: string;
}

export interface StructuredIntelResult {
    report: string;
    marks: IntelMapOverlay;
    marksJson: string;
    visualization?: StructuredIntelResultVisualization;
}

const pointSchema = z.object({
    x: z.number(),
    y: z.number(),
});

const intelUnitSchema = z.object({
    id: z.string().optional(),
    type: z.enum(INTEL_UNIT_TYPES),
    position: pointSchema,
    label: z.string().optional(),
});

const intelAreaHighlightSchema = z.object({
    vertices: z.array(pointSchema).min(3),
    label: z.string().optional(),
});

export const intelMapOverlaySchema = z.object({
    units: z.array(intelUnitSchema),
    areas: z.array(intelAreaHighlightSchema),
});

export const structuredIntelJsonSchema = z.object({
    report: z.string().default(""),
    marks: intelMapOverlaySchema.default({ units: [], areas: [] }),
});

export function createEmptyIntelMapOverlay(): IntelMapOverlay {
    return {
        units: [],
        areas: [],
    };
}

export function createStructuredIntelResult(report: string, marks: IntelMapOverlay): StructuredIntelResult {
    const safeMarks = intelMapOverlaySchema.parse(marks);
    return {
        report: report.trim(),
        marks: safeMarks,
        marksJson: JSON.stringify(safeMarks, null, 2),
    };
}
