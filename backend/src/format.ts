import { Sitrep, GroupSitrepStatus } from "./sitrep";
import { Point } from "./geography";

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