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

    public format(sitrep: Sitrep): string {
        const lines: string[] = [];
        lines.push(`${sitrep.groupName}:`);
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