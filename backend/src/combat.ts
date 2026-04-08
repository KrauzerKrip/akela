import { t } from "elysia";
import { CombatEndedEvent, CombatModeChangedEvent, EnemyContactEvent, EnemyDetectedEvent, EngagedInCombatEvent, EngineGroupEvent, Group, TacticalGroupEvent, Task } from "./army";
import { Point3D } from "./geography";

export type TacticalEventListener = (event: TacticalGroupEvent) => void;

export enum GroupStatus {
    Engaged,
    Normal
}

export interface TrackedEnemy {
    position: Point3D;
    kind: string;
}

export class GroupCombatMonitor {
    private group: Group;
    private status: GroupStatus;
    private combatBehaviour: string;
    private lastDetectionTime: number = 0;

    // How many milliseconds without a detection before we consider combat "ended"
    private readonly COMBAT_COOLDOWN_MS = 30000;
    private cooldownTimer: NodeJS.Timeout | null = null;

    private readonly BATCH_WINDOW_MS = 2000;
    private readonly FORGET_TIME_MS = 60000;

    private knownEnemies = new Map<string, TrackedEnemy>();
    private enemyForgetTimers = new Map<string, NodeJS.Timeout>();
    private batchedTargetIds = new Set<string>();
    private batchTimer: NodeJS.Timeout | null = null;

    private listeners: TacticalEventListener[] = [];

    constructor(group: Group) {
        this.group = group;
        this.status = GroupStatus.Normal;
        // Subscribe to the raw, spammy events
        this.group.subscribe(this.handleRawGroupEvent.bind(this));
        this.combatBehaviour = "AWARE"; // reasonable default
    }

    public subscribe(listener: TacticalEventListener) {
        this.listeners.push(listener);
    }

    public getKnownEnemyPositions(): Point3D[] {
        const positions = [];
        for (let [key, value] of this.knownEnemies) {
            positions.push(value.position);
        }
        return positions;
    }

    public getKnownEnemies(): TrackedEnemy[] {
        return Array.from(this.knownEnemies.values());
    }

    public getStatus(): GroupStatus {
        return this.status;
    }

    public getCombatBehaviour(): string {
        return this.combatBehaviour
    }

    private emitTacticalEvent(event: TacticalGroupEvent) {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    private handleRawGroupEvent(event: EngineGroupEvent) {
        switch (event.type) {
            case "ENEMY_DETECTED":
                this.handleEnemyDetected(event as EnemyDetectedEvent);
                break;
            case "COMBAT_MODE_CHANGED":
                this.handleCombatModeChanged(event as CombatModeChangedEvent);
                break;
            // Handle other low-level events to derive high-level state
        }
    }

    private handleEnemyDetected(event: EnemyDetectedEvent) {
        this.lastDetectionTime = Date.now();
        const targetId = event.newTargetId || "UNKNOWN";

        this.knownEnemies.set(targetId, { position: event.position, kind: event.kind });
        if (this.enemyForgetTimers.has(targetId)) {
            clearTimeout(this.enemyForgetTimers.get(targetId)!);
        }

        this.enemyForgetTimers.set(targetId, setTimeout(() => {
            this.knownEnemies.delete(targetId);
            this.enemyForgetTimers.delete(targetId);
        }, this.FORGET_TIME_MS));

        this.batchedTargetIds.add(targetId);

        if (!this.batchTimer) {
            this.batchTimer = setTimeout(() => {
                if (this.status == GroupStatus.Normal) {
                    this.status = GroupStatus.Engaged;
                }

                const targetIds = Array.from(this.batchedTargetIds);
                this.emitTacticalEvent({
                    type: "ENEMY_CONTACT",
                    groupId: this.group.id,
                    targetIds: targetIds,
                    contactCount: targetIds.length
                } as EnemyContactEvent);

                this.batchedTargetIds.clear();
                this.batchTimer = null;
            }, this.BATCH_WINDOW_MS);
        }

        // Reset the cooldown timer every time a spammy detection event comes in
        this.resetCooldownTimer();
    }

    private handleCombatModeChanged(event: CombatModeChangedEvent) {
        this.combatBehaviour = event.newMode;
        if (event.newMode === "COMBAT") {
            this.status = GroupStatus.Engaged;
            this.emitTacticalEvent({
                type: "ENGAGED_IN_COMBAT",
                groupId: this.group.id
            } as EngagedInCombatEvent);
        } else if (event.newMode === "AWARE") {
            if (this.status == GroupStatus.Engaged) {
                this.status = GroupStatus.Normal;
                this.emitTacticalEvent({
                    type: "COMBAT_ENDED",
                    groupId: this.group.id
                } as CombatEndedEvent);
            }
        }
    }

    private resetCooldownTimer() {
        if (this.cooldownTimer) {
            clearTimeout(this.cooldownTimer);
        }

        this.cooldownTimer = setTimeout(() => {
            // State Transition: Combat -> Peaceful
            this.status = GroupStatus.Normal;

            this.emitTacticalEvent({
                type: "COMBAT_ENDED",
                groupId: this.group.id
            } as CombatEndedEvent);

            this.cooldownTimer = null;
        }, this.COMBAT_COOLDOWN_MS);
    }
}
