import path from "path";
import { ArmaConnector } from "./arma_connection";
import {
    ArmyComposer,
    Group,
    Task
} from "./army";
import { ArmyCombatMonitor } from "./combat";
import { EventHubCompositionProgressLogger } from "./composition_progress";
import { eventHub, withEnvelope } from "./event";
import { PipelineFactory } from "./pipeline";
import { runtimeState } from "./runtime_state";
import { Session } from "./session";

export interface SessionInitializePayload {
    intel: {
        photos?: string[];
        observations?: string[];
        [key: string]: unknown;
    };
    area: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        world?: string;
        [key: string]: unknown;
    };
    missionName?: string;
    worldName?: string;
    side?: string;
}

export interface SessionInitializeResult {
    id: string;
    worldName: string | null;
    missionName: string | null;
    startTime: string;
}

function resolveSource(event: Record<string, any>): "GAME" | "AI" | "USER" | "SYSTEM" {
    if (event.type === "USER_COMMAND") {
        return "USER";
    }
    if (event.type === "AGENT_RESPONSE" || event.type === "NEW_PLAN" || event.type === "LLM_DECISION_START") {
        return "AI";
    }
    return "GAME";
}

interface LiveSessionRuntime {
    sessionId: string;
    groups: Group[];
    stateTickInterval: ReturnType<typeof setInterval>;
    unsubscribeEventLog: () => void;
}

function toPointTuple(value: unknown): [number, number] | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const point = value as { x?: unknown; y?: unknown };
    if (typeof point.x !== "number" || typeof point.y !== "number") {
        return null;
    }
    return [point.x, point.y];
}

function serializeTask(task: Task | null | undefined): Record<string, unknown> | null {
    if (!task) {
        return null;
    }
    const taskWithGeometry = task as Task & {
        getFinalWaypointPosition?: () => unknown;
        getWaypointPositions?: () => unknown;
    };
    const destination = taskWithGeometry.getFinalWaypointPosition
        ? toPointTuple(taskWithGeometry.getFinalWaypointPosition())
        : null;
    const waypointPositions = taskWithGeometry.getWaypointPositions
        ? taskWithGeometry.getWaypointPositions()
        : [];
    const waypoints = Array.isArray(waypointPositions)
        ? waypointPositions
            .map((position) => toPointTuple(position))
            .filter((position): position is [number, number] => position !== null)
        : [];
    return {
        id: task.id,
        name: task.name,
        type: task.type,
        destination,
        waypoints
    };
}

function serializeLiveEvent(event: Record<string, any>): Record<string, any> {
    const nextEvent = { ...event };
    if ("task" in nextEvent) {
        nextEvent.task = serializeTask(nextEvent.task as Task | null | undefined);
    }
    return nextEvent;
}

export class SessionInitializer {
    private readonly armaConnector: ArmaConnector;
    private readonly pipelineFactory: PipelineFactory;
    private liveRuntime: LiveSessionRuntime | null = null;
    private isInitializing = false;

    constructor(armaConnector: ArmaConnector, pipelineFactory: PipelineFactory) {
        this.armaConnector = armaConnector;
        this.pipelineFactory = pipelineFactory;
    }

    public async initializeSession(payload: SessionInitializePayload): Promise<SessionInitializeResult> {
        if (this.isInitializing) {
            throw new Error("SESSION_INITIALIZATION_IN_PROGRESS");
        }
        if (runtimeState.getActiveSession()) {
            throw new Error("ACTIVE_SESSION_EXISTS");
        }

        this.isInitializing = true;
        const session = new Session(runtimeState.getSessionsDir());
        const progressLogger = new EventHubCompositionProgressLogger(session.getId());

        try {
            session.initialize();
            runtimeState.setActiveSession(session);

            const startTime = new Date().toISOString();
            const worldName = payload.worldName ?? (typeof payload.area.world === "string" ? payload.area.world : null);
            const missionName = payload.missionName ?? null;
            session.saveManifest({
                intelInput: payload,
                worldName,
                missionName,
                startTime
            });

            const side = payload.side ?? "BLUFOR";
            const armyComposer = new ArmyComposer(this.armaConnector, this.armaConnector, progressLogger);
            const army = await armyComposer.composeArmyForSession(session, side);
            const groups = army.getGroups();
            const monitor = ArmyCombatMonitor.fromArmy(army);
            await this.startLiveRuntime(session, groups, monitor);
            if (this.isPipelineDisabled()) {
                eventHub.publish(withEnvelope({
                    source: "SYSTEM",
                    type: "PIPELINE_DISABLED",
                    message: "Agent pipeline disabled via AKELA_DISABLE_AGENT_PIPELINE=1.",
                    sessionId: session.getId()
                } as any) as any);
            } else {
                const pipeline = this.pipelineFactory({ session, payload, army, groups, monitor });
                void pipeline.run().catch((error) => {
                    const message = error instanceof Error ? error.message : "Unknown pipeline failure.";
                    eventHub.publish(withEnvelope({
                        source: "SYSTEM",
                        type: "PIPELINE_FAILED",
                        message,
                        sessionId: session.getId()
                    } as any) as any);
                });
            }

            return {
                id: session.getId(),
                worldName,
                missionName,
                startTime
            };
        } catch (error) {
            progressLogger.log({
                phase: "FAILED",
                message: error instanceof Error ? error.message : "Failed to initialize session."
            });
            runtimeState.setActiveSession(null);
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    private isPipelineDisabled(): boolean {
        const value = process.env.AKELA_DISABLE_AGENT_PIPELINE?.trim().toLowerCase();
        return value === "1" || value === "true" || value === "yes" || value === "on";
    }

    private async startLiveRuntime(session: Session, groups: Group[], monitor: ArmyCombatMonitor): Promise<void> {
        if (this.liveRuntime) {
            this.liveRuntime.unsubscribeEventLog();
            clearInterval(this.liveRuntime.stateTickInterval);
            this.liveRuntime = null;
        }

        const appendAndBroadcast = (event: Record<string, any>) => {
            eventHub.publish(withEnvelope({
                source: resolveSource(event),
                ...(serializeLiveEvent(event) as any),
                sessionId: session.getId()
            }));
        };

        monitor.subscribe((event) => {
            appendAndBroadcast(event as any);
        });

        groups.forEach((group) => {
            group.subscribe((event) => {
                appendAndBroadcast(event as any);
            });
        });

        const unsubscribeEventLog = eventHub.subscribe((event) => {
            if (event.sessionId === session.getId()) {
                session.appendEventLog(event);
            }
        });

        for (const group of groups) {
            await group.updateSituationalData();
        }

        let isTicking = false;
        const stateTickInterval = setInterval(async () => {
            if (isTicking) {
                return;
            }
            isTicking = true;
            try {
                for (const group of groups) {
                    await group.updateSituationalData();
                }

                let allKnownEnemies: any[] = [];
                groups.forEach((group) => {
                    const groupMonitor = monitor.getGroupMonitor(group.id);
                    if (groupMonitor) {
                        allKnownEnemies = allKnownEnemies.concat(groupMonitor.getKnownEnemies());
                    }
                });

                appendAndBroadcast({
                    type: "STATE_TICK",
                    groups: groups.map((group) => ({
                        id: group.id,
                        groupId: group.id,
                        name: group.getName(),
                        position: [group.getPosition().x, group.getPosition().y],
                        task: serializeTask(group.getCurrentTask())
                    })),
                    knownEnemies: allKnownEnemies.map((enemy) => ({
                        position: [enemy.position.x, enemy.position.y, enemy.position.z],
                        kind: enemy.kind
                    }))
                });
            } catch (error) {
                console.error("Failed to execute state tick:", error);
            } finally {
                isTicking = false;
            }
        }, 1000);

        this.liveRuntime = {
            sessionId: session.getId(),
            groups,
            stateTickInterval,
            unsubscribeEventLog
        };
    }
}

export function configureRuntimeDirs(): void {
    runtimeState.setSessionsDir(path.join(process.cwd(), "..", ".data", "sessions"));
    runtimeState.setMapCacheDir(path.join(process.cwd(), "..", ".data", "map_cache"));
}
