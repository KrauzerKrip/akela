import { Sitrep, GroupSitrepStatus } from "./sitrep";
import { Point } from "./geography";
import { readFileSync } from "fs";
import { join } from "path";

export interface SitrepFormatter {
    format(sitrep: Sitrep): string;
}

export class YamlSitrepFormatter implements SitrepFormatter {
    private formatGrid(p: Point): string {
        const formatCoord = (c: number) => Math.floor(c / 100).toString().padStart(3, '0');
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
                lines.push(`    Stance: "${sitrep.task.behaviour}"`);
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
    formatSystemPrompt(): string;
    formatUserPrompt(observations: string[]): string;
}

export class SimpleIntelPromptFormatter implements IntelPromptFormatter {
    private systemPromptTemplate: string;
    private userPromptTemplate: string;

    constructor() {
        this.systemPromptTemplate = readFileSync(join(__dirname, "prompts", "intel_system_prompt.md"), "utf-8");
        this.userPromptTemplate = readFileSync(join(__dirname, "prompts", "intel_user_prompt.d"), "utf-8");
    }

    public formatSystemPrompt(): string {
        return this.systemPromptTemplate;
    }

    public formatUserPrompt(observations: string[]): string {
        const observationString = observations.join("\n");
        const variables: Record<string, string> = {
            "OBSERVATION_BLOCK": observationString,
        }

        let formatted = this.userPromptTemplate;
        for (const [key, value] of Object.entries(variables)) {
            formatted = formatted.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        return formatted;
    }
}

export interface ExecutionPromptFormatter {
    format(sitreps: Sitrep[]): string;
    // @TODO
}

export class SimpleExecutionPromptFormatter implements ExecutionPromptFormatter {
    private sitrepFormatter: SitrepFormatter;
    private template: string;

    constructor(sitrepFormatter: SitrepFormatter) {
        this.sitrepFormatter = sitrepFormatter;
        this.template = readFileSync(join(__dirname, "prompts", "execution_system_prompt.md"), "utf-8");
    }

    public format(sitreps: Sitrep[]): string {
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");

        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
        };

        let formatted = this.template;
        for (const [key, value] of Object.entries(variables)) {
            formatted = formatted.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        return formatted;
    }
}

export interface PlanPromptFormatter {
    formatSystemPrompt(): string;
    formatUserPrompt(sitreps: Sitrep[], intel: string): string;
}

export class SimplePlanPromptFormatter implements PlanPromptFormatter {
    private sitrepFormatter: SitrepFormatter;
    private systemPromptTemplate: string;
    private userPromptTemplate: string;

    constructor(sitrepFormatter: SitrepFormatter) {
        this.sitrepFormatter = sitrepFormatter;
        this.systemPromptTemplate = readFileSync(join(__dirname, "prompts", "plan_system_prompt.md"), "utf-8");
        this.userPromptTemplate = readFileSync(join(__dirname, "prompts", "plan_user_prompt.md"), "utf-8");
    }

    public formatSystemPrompt(): string {
        return this.systemPromptTemplate;
    }

    public formatUserPrompt(sitreps: Sitrep[], intel: string): string {
        const sitrepStr = sitreps.map(s => this.sitrepFormatter.format(s)).join("\n");

        const variables: Record<string, string> = {
            "SITREP_BLOCK": sitrepStr,
            "INTEL_BLOCK": intel,
        };

        let formatted = this.userPromptTemplate;
        for (const [key, value] of Object.entries(variables)) {
            formatted = formatted.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }

        return formatted;
    }
}