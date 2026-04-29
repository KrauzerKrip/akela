import { Sitrep, GroupSitrepStatus } from "./sitrep";
import { Point } from "./geography";
import { LangfuseClient } from "@langfuse/client";

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
export interface IntelPromptFormatter {
    formatPrompt(observations: string[]): Promise<{ system: string; user: string; prompt: any }>;
}

export class SimpleIntelPromptFormatter implements IntelPromptFormatter {
    private langfuse = new LangfuseClient();

    public async formatPrompt(observations: string[]): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("intel_prompt", { label: "production", type: "chat" });
        const observationString = observations.join("\n");
        const variables: Record<string, string> = {
            "OBSERVATION_BLOCK": observationString,
        };
        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find(m => m.role === "system")?.content || "";
        const user = compiled.find(m => m.role === "user")?.content || "";
        return { system, user, prompt };
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
    formatPrompt(sitreps: Sitrep[], intel: string): Promise<{ system: string; user: string; prompt: any }>;
}

export class SimplePlanPromptFormatter implements PlanPromptFormatter {
    private sitrepFormatter: SitrepFormatter;
    private langfuse = new LangfuseClient();

    constructor(sitrepFormatter: SitrepFormatter) {
        this.sitrepFormatter = sitrepFormatter;
    }

    public async formatPrompt(sitreps: Sitrep[], intel: string): Promise<{ system: string; user: string; prompt: any }> {
        const prompt = await this.langfuse.prompt.get("plan_prompt", { label: "production", type: "chat" });
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");

        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
            "INTEL_BLOCK": intel,
        };

        const compiled = prompt.compile(variables) as { role: string; content: string }[];
        const system = compiled.find(m => m.role === "system")?.content || "";
        const user = compiled.find(m => m.role === "user")?.content || "";

        return { system, user, prompt };
    }
}