import { Sitrep, GroupSitrepStatus } from "./sitrep";
import { GameMapArea, Point } from "./geography";
import { LangfuseClient } from "@langfuse/client";
import { INTEL_UNIT_TYPES, StructuredIntelResult } from "./intel/models";

export interface SitrepFormatter {
    format(sitrep: Sitrep): string;
}

export class YamlSitrepFormatter implements SitrepFormatter {
    private formatGrid(p: Point): string {
        const formatCoord = (c: number) => (c / 100).toFixed(2).padStart(6, '0');
        return `${formatCoord(p.x)}-${formatCoord(p.y)}`;
    }

    /**
         * Helper to convert an array of strings/roles into a summarized "2x Role, 1x Other" string
         */
    private summarizeItems(items: string[]): string {
        const counts = items.reduce((acc, item) => {
            acc[item] = (acc[item] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(counts)
            .map(([name, count]) => `${count}x ${name}`)
            .join(", ");
    }

    public format(sitrep: Sitrep): string {
        const lines: string[] = [];
        lines.push(`${sitrep.groupName}:`);

        // Formats units: [3x Rifleman, 1x AT]
        const unitRoles = sitrep.units.map(u => u.role);
        lines.push(`    Units: [${this.summarizeItems(unitRoles)}]`);

        // Formats vehicles: [1x M1 Abrams, 2x Humvee]
        if (sitrep.vehicles && sitrep.vehicles.length > 0) {
            lines.push(`    Vehicles: [${this.summarizeItems(sitrep.vehicles)}]`);
        } else {
            lines.push(`    Vehicles: []`);
        }

        lines.push(`    Grid: "${this.formatGrid(sitrep.position)}"`);

        const statusStr = sitrep.status === GroupSitrepStatus.Engaged ? "Engaged" : "Normal";
        lines.push(`    Status: "${statusStr}"`);

        const effectivenessPercent = Math.round(sitrep.effectiveness * 100);
        lines.push(`    Effectiveness: ${effectivenessPercent}%`);

        if (sitrep.task) {
            lines.push(`    Task: "${sitrep.task.type}: ${sitrep.task.name}"`);
            if (sitrep.task.destination) {
                lines.push(`    Destination: "${this.formatGrid(sitrep.task.destination)}"`);
            }
            if (sitrep.task.behaviour) {
                lines.push(`    Behaviour: "${sitrep.task.behaviour}"`);
            }
        }

        if (sitrep.contacts && sitrep.contacts.length > 0) {
            const contactsStr = sitrep.contacts.map(c =>
                `${c.count}x ${c.kind} at ${this.formatGrid(c.position)}`
            ).join(', ');
            lines.push(`    Contacts: [${contactsStr}]`);
        }

        return lines.join('\n');
    }
}
/** Variables for `intel_extract_prompt` (Langfuse). */
export interface IntelExtractBatchPromptVars {
    batchIndexOneBased: number;
    batchTotal: number;
    photoIndexFirst: number;
    photoIndexLast: number;
    observations: string[];
}

export interface IntelPromptFormatter {
    formatPrompt(observations: string[], gameMapArea?: GameMapArea): Promise<{ system: string; user: string; prompt: any }>;

    /** Staged Intel: vision-only extraction for one UAV batch (prompt `intel_extract_prompt`). */
    formatIntelExtractPrompt(vars: IntelExtractBatchPromptVars): Promise<{ system: string; user: string; prompt: any }>;

    /** Staged Intel: merge batch findings JSON (prompt `intel_merge_prompt`). */
    formatIntelMergePrompt(mergePayloadJson: string): Promise<{ system: string; user: string; prompt: any }>;

    /** Staged Intel: supplement appended before map image on finalize (prompt `intel_finalize_supplement_prompt`). Returns user text only. */
    formatIntelFinalizeSupplement(mergedFindingsJson: string, mapExtentLine: string): Promise<{ supplementUserText: string; prompt: any }>;
}

/** Value for `MAP_EXTENT_BLOCK` in `intel_user_prompt.md` (world meters). */
export function formatIntelMapExtentBlock(area: GameMapArea): string {
    const lb = area.leftBottomCorner;
    const rt = area.rightTopCorner;
    const minX = Math.min(lb.x, rt.x);
    const maxX = Math.max(lb.x, rt.x);
    const minY = Math.min(lb.y, rt.y);
    const maxY = Math.max(lb.y, rt.y);
    return `X from ${minX} to ${maxX}, Y from ${minY} to ${maxY}.`;
}

export class SimpleIntelPromptFormatter implements IntelPromptFormatter {
    private langfuse = new LangfuseClient();

    private compileChatRoles(prompt: { compile: (v: Record<string, string>) => unknown }, variables: Record<string, string>): {
        system: string;
        user: string;
    } {
        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find((m) => m.role === "system")?.content || "";
        const user = compiled.find((m) => m.role === "user")?.content || "";
        return { system, user };
    }

    public async formatPrompt(observations: string[], gameMapArea?: GameMapArea): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("intel_prompt", { label: "production", type: "chat" });
        const observationString = observations.join("\n");
        const variables: Record<string, string> = {
            "OBSERVATION_BLOCK": observationString,
            "INTEL_MARK_UNIT_TYPES": INTEL_UNIT_TYPES.join(", "),
            "MAP_EXTENT_BLOCK": gameMapArea ? formatIntelMapExtentBlock(gameMapArea) : "Not available for this run.",
        };
        const { system, user } = this.compileChatRoles(prompt, variables);
        return { system, user, prompt };
    }

    public async formatIntelExtractPrompt(vars: IntelExtractBatchPromptVars): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("intel_extract_prompt", { label: "production", type: "chat" });
        const observationBlock =
            vars.observations.length > 0 ? vars.observations.join("\n") : "(none)";
        const variables: Record<string, string> = {
            INTEL_BATCH_INDEX_ONE_BASED: String(vars.batchIndexOneBased),
            INTEL_BATCH_TOTAL: String(vars.batchTotal),
            INTEL_PHOTO_INDEX_FIRST: String(vars.photoIndexFirst),
            INTEL_PHOTO_INDEX_LAST: String(vars.photoIndexLast),
            OBSERVATION_BLOCK: observationBlock,
        };
        const { system, user } = this.compileChatRoles(prompt, variables);
        return { system, user, prompt };
    }

    public async formatIntelMergePrompt(mergePayloadJson: string): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("intel_merge_prompt", { label: "production", type: "chat" });
        const variables: Record<string, string> = {
            MERGE_PAYLOAD_JSON: mergePayloadJson,
        };
        const { system, user } = this.compileChatRoles(prompt, variables);
        return { system, user, prompt };
    }

    public async formatIntelFinalizeSupplement(
        mergedFindingsJson: string,
        mapExtentLine: string,
    ): Promise<{ supplementUserText: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("intel_finalize_supplement_prompt", {
            label: "production",
            type: "chat",
        });
        const variables: Record<string, string> = {
            MERGED_FINDINGS_JSON: mergedFindingsJson,
            MAP_EXTENT_LINE: mapExtentLine,
        };
        const { user } = this.compileChatRoles(prompt, variables);
        return { supplementUserText: user, prompt };
    }
}

export interface ExecutionPromptFormatter {
    formatPlanPrompt(sitreps: Sitrep[], planDescription: string, planCode: string): Promise<{ system: string; user: string; prompt: any }>;
    formatReportPrompt(sitreps: Sitrep[], report: string): Promise<{ system: string; user: string; prompt: any }>;
    formatInterventionPrompt(sitreps: Sitrep[], command: string, targetAgent: string): Promise<{ system: string; user: string; prompt: any }>;
}

export class SimpleExecutionPromptFormatter implements ExecutionPromptFormatter {
    private sitrepFormatter: SitrepFormatter;
    private langfuse = new LangfuseClient();

    constructor(sitrepFormatter: SitrepFormatter) {
        this.sitrepFormatter = sitrepFormatter;
    }

    public async formatPlanPrompt(sitreps: Sitrep[], planDescription: string, planCode: string): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("execution_plan_prompt", { label: "production", type: "chat" });
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");

        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
            "PLAN_DESCRIPTION": planDescription,
            "PLAN_CODE": planCode
        };

        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find(m => m.role === "system")?.content || "";
        const user = compiled.find(m => m.role === "user")?.content || "";

        return { system, user, prompt };
    }

    public async formatReportPrompt(sitreps: Sitrep[], report: string): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("execution_report_prompt", { label: "production", type: "chat" });
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");

        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
            "REPORT": report
        };

        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find(m => m.role === "system")?.content || "";
        const user = compiled.find(m => m.role === "user")?.content || "";

        return { system, user, prompt };
    }

    public async formatInterventionPrompt(sitreps: Sitrep[], command: string, targetAgent: string): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("execution_intervention_prompt", { label: "production", type: "chat" });
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");
        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
            "COMMANDER_MESSAGE": command,
        };
        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find(m => m.role === "system")?.content || "";
        const user = compiled.find(m => m.role === "user")?.content || "";
        return { system, user, prompt };
    }
}

export interface PlanPromptFormatter {
    formatPrompt(sitreps: Sitrep[], intel: StructuredIntelResult): Promise<{ system: string; user: string; prompt: any }>;
}

export class SimplePlanPromptFormatter implements PlanPromptFormatter {
    private sitrepFormatter: SitrepFormatter;
    private langfuse = new LangfuseClient();

    constructor(sitrepFormatter: SitrepFormatter) {
        this.sitrepFormatter = sitrepFormatter;
    }

    public async formatPrompt(sitreps: Sitrep[], intel: StructuredIntelResult): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("plan_prompt", { label: "production", type: "chat" });
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");

        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
            "INTEL_BLOCK": intel.report,
            "INTEL_MARKS_JSON": intel.marksJson,
        };

        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find(m => m.role === "system")?.content || "";
        const user = compiled.find(m => m.role === "user")?.content || "";

        return { system, user, prompt };
    }
}