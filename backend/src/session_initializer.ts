import fs from "fs";
import path from "path";
import { propagateAttributes } from "@langfuse/tracing";
import { DatabaseSessionService } from "@google/adk";
import { ExecutionAgent, Image, Intel, IntelAgent, NewPlanEvent, PlanAgent } from "./agent";
import { ArmaConnector } from "./arma_connection";
import {
    Army,
    ArmyComposer,
    EnemyContactEvent,
    Group,
    GroupEvent,
    TacticalGroupEvent,
    TaskCompletedEvent
} from "./army";
import { ArmyCombatMonitor } from "./combat";
import { EventHubCompositionProgressLogger } from "./composition_progress";
import { eventHub, withEnvelope } from "./event";
import { SimpleExecutionPromptFormatter, SimpleIntelPromptFormatter, SimplePlanPromptFormatter, YamlSitrepFormatter } from "./format";
import { GameMap } from "./geography";
import type { Plan } from "./plan/models";
import { PlanSandbox } from "./plan/sandbox";
import { PlanVisualizer } from "./plan/visualization";
import { runtimeState } from "./runtime_state";
import { Session } from "./session";
import { createSitrep } from "./sitrep";

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

export class SessionInitializer {
    private readonly armaConnector: ArmaConnector;
    private liveRuntime: LiveSessionRuntime | null = null;
    private isInitializing = false;

    constructor(armaConnector: ArmaConnector) {
        this.armaConnector = armaConnector;
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
                void this.startPipeline(session, payload, army, groups, monitor).catch((error) => {
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

    private async startPipeline(
        session: Session,
        payload: SessionInitializePayload,
        army: Army,
        groups: Group[],
        monitor: ArmyCombatMonitor
    ): Promise<void> {
        const dbUrl = process.env.SESSION_DB_URL;
        if (!dbUrl) {
            throw new Error("SESSION_DB_URL is required to start Intel/Plan/Execution pipeline.");
        }

        await propagateAttributes(
            {
                traceName: "AgenticPipeline",
                sessionId: session.getId(),
                tags: ["initial"]
            },
            async () => {
                const sessionService = new DatabaseSessionService(dbUrl);
                await sessionService.init();

                const gameMap = new GameMap(session);
                const gameMapArea = await gameMap.extractArea(
                    { x: payload.area.x1, y: payload.area.y1 },
                    { x: payload.area.x2, y: payload.area.y2 }
                );

                const intel: Intel = {
                    images: (payload.intel.photos ?? [])
                        .filter((photoPath) => typeof photoPath === "string" && fs.existsSync(photoPath))
                        .map((photoPath) => new Image(photoPath)),
                    observations: payload.intel.observations ?? []
                };

                const intelAgent = new IntelAgent(new SimpleIntelPromptFormatter(), sessionService, session);
                const intelResult = await intelAgent.analyze(intel, gameMapArea);
                this.updateManifest(session, { intelResult });

                const sitreps = groups
                    .map((group) => {
                        const groupMonitor = monitor.getGroupMonitor(group.id);
                        return groupMonitor ? createSitrep(group, groupMonitor) : null;
                    })
                    .filter((sitrep): sitrep is NonNullable<typeof sitrep> => sitrep !== null);

                const planSandbox = await PlanSandbox.create();
                const planAgent = new PlanAgent(
                    new SimplePlanPromptFormatter(new YamlSitrepFormatter()),
                    sessionService,
                    session,
                    planSandbox,
                    new PlanVisualizer(session)
                );
                const planningResult = await planAgent.plan(army, sitreps, intelResult, gameMapArea);
                this.updateManifest(session, { planningResult });

                const executionAgent = new ExecutionAgent(
                    new SimpleExecutionPromptFormatter(new YamlSitrepFormatter()),
                    new YamlSitrepFormatter(),
                    sessionService,
                    session,
                    planSandbox
                );

                this.updateManifest(session, { executionEvents: [] });

                const applySandboxPlan = async (newPlan: Plan) => {
                    try {
                        const safePlan = { ...newPlan };
                        this.appendManifestExecutionEvent(session, { type: "NEW_PLAN", plan: safePlan });
                    } catch (e) {
                        console.log("Failed to save sandbox plan to manifest:", e);
                    }
                    await this.actAccordingToPlan(newPlan, army);
                };

                monitor.subscribe(async (event: TacticalGroupEvent) => {
                    const group = army.getGroupById(event.groupId);
                    if (!group) {
                        return;
                    }
                    let planEvent: { type: string; count?: number; kind?: unknown } | null = null;
                    if (event.type === "ENEMY_CONTACT") {
                        const ec = event as EnemyContactEvent;
                        planEvent = {
                            type: "ENEMY_CONTACT",
                            count: ec.contactCount,
                            kind: ec.kind
                        };
                    } else if (
                        event.type === "KIA"
                        || event.type === "ENGAGED_IN_COMBAT"
                        || event.type === "COMBAT_ENDED"
                        || event.type === "TIMEOUT"
                    ) {
                        planEvent = { type: event.type };
                    }

                    if (planEvent) {
                        const newPlan = planSandbox.handlePlanEvent(group, planEvent as any);
                        if (newPlan) {
                            await applySandboxPlan(newPlan);
                        }
                    }
                });

                groups.forEach((group) => {
                    group.subscribe(async (event: GroupEvent) => {
                        if (event.type === "TASK_COMPLETED") {
                            const taskName = (event as TaskCompletedEvent).task.name;
                            const planEvent = { type: "TASK_COMPLETE" as const, taskName };
                            const newPlan = planSandbox.handlePlanEvent(group, planEvent);
                            if (newPlan) {
                                await applySandboxPlan(newPlan);
                            }
                        }
                    });
                });

                for await (const executionEvent of executionAgent.execute(army, monitor, planningResult)) {
                    try {
                        const safeEvent = { ...executionEvent } as Record<string, unknown>;
                        if (safeEvent.type === "NEW_PLAN") {
                            delete safeEvent.plan;
                        }
                        this.appendManifestExecutionEvent(session, safeEvent);
                    } catch (e) {
                        console.log("Failed to save execution event to manifest:", e);
                    }

                    if (executionEvent.type === "AGENT_RESPONSE") {
                        eventHub.publish(withEnvelope({
                            source: "AI",
                            type: "AGENT_RESPONSE",
                            response: (executionEvent as any).response,
                            sessionId: session.getId()
                        } as any) as any);
                    } else if (executionEvent.type === "NEW_PLAN") {
                        eventHub.publish(withEnvelope({
                            source: "AI",
                            type: "NEW_PLAN",
                            code: (executionEvent as any).code,
                            sessionId: session.getId()
                        } as any) as any);
                        const plan = (executionEvent as NewPlanEvent).plan;
                        await this.actAccordingToPlan(plan, army);
                    }
                }
            }
        );
    }

    private async actAccordingToPlan(plan: Plan, army: Army): Promise<void> {
        const armyGroups = army.getGroups();
        for (const group of armyGroups) {
            if (plan.queuedTasks?.[group.id]) {
                plan.queuedTasks[group.id].forEach((task) => {
                    group.addTaskToQueue(task);
                });
            }
            if (plan.immediateTasks?.[group.id]) {
                void group.executeImmediately(plan.immediateTasks[group.id]);
            }
            if (plan.clearGroupTasks?.[group.id]) {
                group.clearTasks();
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    private isPipelineDisabled(): boolean {
        const value = process.env.AKELA_DISABLE_AGENT_PIPELINE?.trim().toLowerCase();
        return value === "1" || value === "true" || value === "yes" || value === "on";
    }

    private updateManifest(session: Session, patch: Record<string, unknown>): void {
        const manifestPath = path.join(session.getDirectory(), "manifest.json");
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(manifestPath)) {
            existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        }
        session.saveManifest({
            ...existing,
            ...patch
        });
    }

    private appendManifestExecutionEvent(session: Session, entry: Record<string, unknown>): void {
        const manifestPath = path.join(session.getDirectory(), "manifest.json");
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(manifestPath)) {
            existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        }
        const executionEvents = Array.isArray(existing.executionEvents)
            ? [...(existing.executionEvents as unknown[])]
            : [];
        executionEvents.push(entry);
        session.saveManifest({
            ...existing,
            executionEvents
        });
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
                ...(event as any),
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
                        task: group.getCurrentTask()
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
