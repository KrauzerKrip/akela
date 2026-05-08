import fs from "fs";
import path from "path";
import { propagateAttributes } from "@langfuse/tracing";
import { DatabaseSessionService, BaseSessionService } from "@google/adk";
import {
    ExecutionAgent,
    Image,
    Intel,
    IntelAgent,
    NewPlanEvent,
    PlanAgent,
    PlanningResult,
    ExecutionEvent
} from "./agent";
import {
    Army,
    EnemyContactEvent,
    Group,
    GroupEvent,
    Task,
    TacticalGroupEvent,
    TaskCompletedEvent
} from "./army";
import { ArmyCombatMonitor } from "./combat";
import { eventHub, withEnvelope } from "./event";
import {
    SimpleExecutionPromptFormatter,
    SimpleIntelPromptFormatter,
    SimplePlanPromptFormatter,
    YamlSitrepFormatter
} from "./format";
import { GameMap, GameMapArea } from "./geography";
import type { Plan } from "./plan/models";
import { PlanSandbox } from "./plan/sandbox";
import { PlanVisualizer } from "./plan/visualization";
import { Session } from "./session";
import { createSitrep, Sitrep } from "./sitrep";
import type { SessionInitializePayload } from "./session_initializer";
import { StructuredIntelResult, createEmptyIntelMapOverlay, createStructuredIntelResult } from "./intel/models";

export interface PipelineDeps {
    session: Session;
    payload: SessionInitializePayload;
    army: Army;
    groups: Group[];
    monitor: ArmyCombatMonitor;
}

export type PipelineFactory = (deps: PipelineDeps) => Pipeline;

interface IntelStageContext {
    sessionService: BaseSessionService;
    gameMapArea: GameMapArea;
}

interface PlanStageContext {
    sessionService: BaseSessionService;
    planSandbox: PlanSandbox;
    gameMapArea: GameMapArea;
    sitreps: Sitrep[];
    intelResult: StructuredIntelResult;
}

interface ExecutionStageContext {
    sessionService: BaseSessionService;
    planSandbox: PlanSandbox;
    planningResult: PlanningResult;
}

interface SerializedTaskRoute {
    id: string;
    name: string;
    type: string;
    destination: [number, number] | null;
    waypoints: Array<[number, number]>;
}

interface SerializedPlanGroupRoutes {
    groupId: string;
    clearQueue: boolean;
    immediateTask: SerializedTaskRoute | null;
    queuedTasks: SerializedTaskRoute[];
}

interface SerializedPlanSummary {
    groups: SerializedPlanGroupRoutes[];
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

function serializeTask(task: Task | null | undefined): SerializedTaskRoute | null {
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

function serializePlanSummary(plan: Plan): SerializedPlanSummary {
    const groupIds = new Set<string>([
        ...Object.keys(plan.immediateTasks ?? {}),
        ...Object.keys(plan.queuedTasks ?? {}),
        ...Object.keys(plan.clearGroupTasks ?? {})
    ]);
    return {
        groups: [...groupIds].map((groupId) => ({
            groupId,
            clearQueue: Boolean(plan.clearGroupTasks?.[groupId]),
            immediateTask: serializeTask(plan.immediateTasks?.[groupId] ?? null),
            queuedTasks: (plan.queuedTasks?.[groupId] ?? [])
                .map((task) => serializeTask(task))
                .filter((task): task is SerializedTaskRoute => task !== null)
        }))
    };
}

export abstract class Pipeline {
    protected readonly session: Session;
    protected readonly payload: SessionInitializePayload;
    protected readonly army: Army;
    protected readonly groups: Group[];
    protected readonly monitor: ArmyCombatMonitor;

    constructor(deps: PipelineDeps) {
        this.session = deps.session;
        this.payload = deps.payload;
        this.army = deps.army;
        this.groups = deps.groups;
        this.monitor = deps.monitor;
    }

    public async run(): Promise<void> {
        const dbUrl = process.env.SESSION_DB_URL;
        if (!dbUrl) {
            throw new Error("SESSION_DB_URL is required to start Intel/Plan/Execution pipeline.");
        }

        await propagateAttributes(
            {
                traceName: "AgenticPipeline",
                sessionId: this.session.getId(),
                tags: ["initial"]
            },
            async () => {
                const sessionService = new DatabaseSessionService(dbUrl);
                await sessionService.init();

                const gameMap = new GameMap(this.session);
                const gameMapArea = await gameMap.extractArea(
                    { x: this.payload.area.x1, y: this.payload.area.y1 },
                    { x: this.payload.area.x2, y: this.payload.area.y2 }
                );

                const intelResult = await this.produceIntelReport({ sessionService, gameMapArea });
                this.updateManifest({ intelResult });

                const sitreps = this.groups
                    .map((group) => {
                        const groupMonitor = this.monitor.getGroupMonitor(group.id);
                        return groupMonitor ? createSitrep(group, groupMonitor) : null;
                    })
                    .filter((sitrep): sitrep is NonNullable<typeof sitrep> => sitrep !== null);

                const planSandbox = await PlanSandbox.create();
                const planningResult = await this.producePlanningResult({
                    sessionService,
                    planSandbox,
                    gameMapArea,
                    sitreps,
                    intelResult
                });
                this.updateManifest({ planningResult });

                this.updateManifest({ executionEvents: [] });

                const applySandboxPlan = async (newPlan: Plan) => {
                    try {
                        const safePlan = { ...newPlan };
                        this.appendManifestExecutionEvent({ type: "NEW_PLAN", plan: safePlan });
                    } catch (e) {
                        console.log("Failed to save sandbox plan to manifest:", e);
                    }
                    await this.applyPlan(newPlan);
                };

                this.monitor.subscribe(async (event: TacticalGroupEvent) => {
                    const group = this.army.getGroupById(event.groupId);
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

                this.groups.forEach((group) => {
                    group.subscribe(async (event: GroupEvent) => {
                        if (event.type === "TASK_COMPLETED") {
                            const completedTask = (event as TaskCompletedEvent).task;
                            if (!completedTask) {
                                return;
                            }
                            const taskName = completedTask.name;
                            const planEvent = { type: "TASK_COMPLETE" as const, taskName };
                            const newPlan = planSandbox.handlePlanEvent(group, planEvent);
                            if (newPlan) {
                                await applySandboxPlan(newPlan);
                            }
                        }
                    });
                });

                for await (const executionEvent of this.runExecution({
                    sessionService,
                    planSandbox,
                    planningResult
                })) {
                    try {
                        const safeEvent = { ...executionEvent } as Record<string, unknown>;
                        if (safeEvent.type === "NEW_PLAN") {
                            delete safeEvent.plan;
                        }
                        this.appendManifestExecutionEvent(safeEvent);
                    } catch (e) {
                        console.log("Failed to save execution event to manifest:", e);
                    }

                    if (executionEvent.type === "AGENT_RESPONSE") {
                        eventHub.publish(withEnvelope({
                            source: "AI",
                            type: "AGENT_RESPONSE",
                            response: (executionEvent as any).response,
                            sessionId: this.session.getId()
                        } as any) as any);
                    } else if (executionEvent.type === "NEW_PLAN") {
                        const plan = (executionEvent as NewPlanEvent).plan;
                        eventHub.publish(withEnvelope({
                            source: "AI",
                            type: "NEW_PLAN",
                            code: (executionEvent as any).code,
                            planSummary: serializePlanSummary(plan),
                            sessionId: this.session.getId()
                        } as any) as any);
                        await this.applyPlan(plan);
                    }
                }
            }
        );
    }

    protected abstract produceIntelReport(ctx: IntelStageContext): Promise<StructuredIntelResult>;

    protected async producePlanningResult(ctx: PlanStageContext): Promise<PlanningResult> {
        const planAgent = new PlanAgent(
            new SimplePlanPromptFormatter(new YamlSitrepFormatter()),
            ctx.sessionService,
            this.session,
            ctx.planSandbox,
            new PlanVisualizer(this.session)
        );
        return planAgent.plan(this.army, ctx.sitreps, ctx.intelResult, ctx.gameMapArea);
    }

    protected async *runExecution(ctx: ExecutionStageContext): AsyncGenerator<ExecutionEvent> {
        const executionAgent = new ExecutionAgent(
            new SimpleExecutionPromptFormatter(new YamlSitrepFormatter()),
            new YamlSitrepFormatter(),
            ctx.sessionService,
            this.session,
            ctx.planSandbox
        );
        yield* executionAgent.execute(this.army, this.monitor, ctx.planningResult);
    }

    protected async applyPlan(plan: Plan): Promise<void> {
        const armyGroups = this.army.getGroups();
        const verificationTargets: Array<{ group: Group; task: Task }> = [];
        const sessionId = this.session.getId();
        for (const group of armyGroups) {
            const clearQueue = Boolean(plan.clearGroupTasks?.[group.id]);
            const immediateTask = plan.immediateTasks?.[group.id];
            const queuedTasks = plan.queuedTasks?.[group.id] ?? [];
            const currentTask = group.getCurrentTask();
            console.log(
                `[PlanApply] group=${group.getName()} id=${group.id} clearQueue=${clearQueue} immediate=${immediateTask ? `${immediateTask.type}:${immediateTask.name}(${immediateTask.id})` : "none"} queued=${queuedTasks.length} current=${currentTask ? `${currentTask.type}:${currentTask.name}(${currentTask.id})` : "none"}`,
            );
            if (plan.clearGroupTasks?.[group.id]) {
                console.log(`[PlanApply] clearing tasks for group=${group.getName()} id=${group.id}`);
                await group.clearTasks();
                console.log(`[PlanApply] cleared tasks for group=${group.getName()} id=${group.id}`);
            }
            if (plan.immediateTasks?.[group.id]) {
                const task = plan.immediateTasks[group.id];
                verificationTargets.push({ group, task });
                console.log(
                    `[PlanApply] scheduling immediate task group=${group.getName()} id=${group.id} task=${task.type}:${task.name}(${task.id})`,
                );
                void group.executeImmediately(task).catch((error) => {
                    console.error(
                        `[PlanApply] immediate task rejected group=${group.getName()} id=${group.id} task=${task.type}:${task.name}(${task.id})`,
                        error,
                    );
                });
            }
            if (plan.queuedTasks?.[group.id]) {
                plan.queuedTasks[group.id].forEach((task) => {
                    console.log(
                        `[PlanApply] enqueue task group=${group.getName()} id=${group.id} task=${task.type}:${task.name}(${task.id})`,
                    );
                    group.addTaskToQueue(task);
                });
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const { group, task } of verificationTargets) {
            const activeTask = group.getCurrentTask();
            if (activeTask?.id === task.id) {
                eventHub.publish(withEnvelope({
                    source: "SYSTEM",
                    type: "PLAN_APPLY_VERIFICATION",
                    status: "OK",
                    groupId: group.id,
                    groupName: group.getName(),
                    expectedTask: {
                        id: task.id,
                        type: task.type,
                        name: task.name,
                    },
                    activeTask: {
                        id: activeTask.id,
                        type: activeTask.type,
                        name: activeTask.name,
                    },
                    sessionId,
                } as any) as any);
                console.log(
                    `[PlanApply] verification ok group=${group.getName()} id=${group.id} activeTask=${activeTask.type}:${activeTask.name}(${activeTask.id})`,
                );
                continue;
            }

            if (!activeTask) {
                eventHub.publish(withEnvelope({
                    source: "SYSTEM",
                    type: "PLAN_APPLY_VERIFICATION",
                    status: "MISMATCH",
                    reason: "NO_ACTIVE_TASK",
                    groupId: group.id,
                    groupName: group.getName(),
                    expectedTask: {
                        id: task.id,
                        type: task.type,
                        name: task.name,
                    },
                    activeTask: null,
                    sessionId,
                } as any) as any);
                console.warn(
                    `[PlanApply] verification mismatch group=${group.getName()} id=${group.id} expected=${task.type}:${task.name}(${task.id}) activeTask=none`,
                );
                continue;
            }

            eventHub.publish(withEnvelope({
                source: "SYSTEM",
                type: "PLAN_APPLY_VERIFICATION",
                status: "MISMATCH",
                reason: "UNEXPECTED_ACTIVE_TASK",
                groupId: group.id,
                groupName: group.getName(),
                expectedTask: {
                    id: task.id,
                    type: task.type,
                    name: task.name,
                },
                activeTask: {
                    id: activeTask.id,
                    type: activeTask.type,
                    name: activeTask.name,
                },
                sessionId,
            } as any) as any);
            console.warn(
                `[PlanApply] verification mismatch group=${group.getName()} id=${group.id} expected=${task.type}:${task.name}(${task.id}) activeTask=${activeTask.type}:${activeTask.name}(${activeTask.id})`,
            );
        }
    }

    private updateManifest(patch: Record<string, unknown>): void {
        const manifestPath = path.join(this.session.getDirectory(), "manifest.json");
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(manifestPath)) {
            existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        }
        this.session.saveManifest({
            ...existing,
            ...patch
        });
    }

    private appendManifestExecutionEvent(entry: Record<string, unknown>): void {
        const manifestPath = path.join(this.session.getDirectory(), "manifest.json");
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(manifestPath)) {
            existing = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        }
        const executionEvents = Array.isArray(existing.executionEvents)
            ? [...(existing.executionEvents as unknown[])]
            : [];
        executionEvents.push(entry);
        this.session.saveManifest({
            ...existing,
            executionEvents
        });
    }
}

export class FullPipeline extends Pipeline {
    protected async produceIntelReport({ sessionService, gameMapArea }: IntelStageContext): Promise<StructuredIntelResult> {
        const intel: Intel = {
            images: (this.payload.intel.photos ?? [])
                .filter((photoPath) => typeof photoPath === "string" && fs.existsSync(photoPath))
                .map((photoPath) => new Image(photoPath)),
            observations: this.payload.intel.observations ?? []
        };
        const intelAgent = new IntelAgent(new SimpleIntelPromptFormatter(), sessionService, this.session);
        return intelAgent.analyze(intel, gameMapArea);
    }
}

export class PremadeIntelPipeline extends Pipeline {
    private readonly premadeIntelReport: string;

    constructor(deps: PipelineDeps, premadeIntelReport: string) {
        super(deps);
        this.premadeIntelReport = premadeIntelReport;
    }

    protected async produceIntelReport(): Promise<StructuredIntelResult> {
        return createStructuredIntelResult(this.premadeIntelReport, createEmptyIntelMapOverlay());
    }
}
