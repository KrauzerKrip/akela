import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Army, Group, Push, Assault, Retreat, Report, Task, Waypoint, GameExecutor, SequenceTask } from "../army";
import { PlanEvent, PlanGroup, Plan } from "./models";
import { Point } from "../geography";
import { translateTask, translateToPlanGroup } from "./translation";
import { validateTransportPlan } from "./transport_validation";

export type PlanSandboxResetMode = "full" | "preserveReactions";

export interface MakePlanOptions {
    resetMode?: PlanSandboxResetMode;
}

export class PlanSandbox {
    private quickJS: any;
    private arena: Arena;
    private taskReactions = new Map<string, Record<string, StoredReaction>>();
    private groupReactions = new Map<string, Record<string, StoredReaction>>();

    private constructor(quickJS: any, arena: Arena) {
        this.quickJS = quickJS;
        this.arena = arena;
    }

    public static async create(): Promise<PlanSandbox> {
        const QuickJS = await getQuickJS();
        const vm = QuickJS.newContext();

        const arena = new Arena(vm, { isMarshalable: true });

        // QuickJS doesn't have 'global' out of the box, map it to globalThis
        arena.evalCode(`globalThis.global = globalThis;`);

        // Load bootstrap
        const bootstrapCode = fs.readFileSync(path.join(import.meta.dir, 'bootstrap.js'), 'utf8');
        arena.evalCode(bootstrapCode);

        return new PlanSandbox(QuickJS, arena);
    }

    public async reset(clearReactions: boolean = true) {
        if (this.arena) {
            this.arena.dispose();
        }
        const vm = this.quickJS.newContext();
        this.arena = new Arena(vm, { isMarshalable: true });
        this.arena.evalCode(`globalThis.global = globalThis;`);
        const bootstrapCode = fs.readFileSync(path.join(import.meta.dir, 'bootstrap.js'), 'utf8');
        this.arena.evalCode(bootstrapCode);
        if (clearReactions) {
            this.taskReactions.clear();
            this.groupReactions.clear();
        } else {
            this.rehydrateStoredReactions();
        }
    }

    public async makePlan(army: Army, code: string, options: MakePlanOptions = {}): Promise<Plan> {
        const resetMode = options.resetMode ?? "full";
        await this.reset(resetMode === "full");
        console.log(`[Sandbox] Making plan for army...`);

        let plan: Plan = {
            immediateTasks: {},
            queuedTasks: {},
            clearGroupTasks: {},
            taskReactions: {},
            groupReactions: {},
        }

        const planGroups: Record<string, PlanGroup> = {};
        for (const g of army.getGroups()) {
            planGroups[g.getName()] = translateToPlanGroup(plan, g);
            plan.clearGroupTasks[g.id] = false;
        }

        this.arena.expose({
            groups: planGroups,
            generateUuid: uuidv4,
            log: console.log,
        });
        this.arena.evalCode(`
            for (const groupName of Object.keys(groups || {})) {
                const group = groups[groupName];
                if (!group || group.__akelaWrappedOn) {
                    continue;
                }
                const originalOn = group.on.bind(group);
                group.on = (event, callback) => {
                    return originalOn(event, {
                        callback,
                        __source: typeof callback === "function" ? callback.toString() : null
                    });
                };
                group.__akelaWrappedOn = true;
            }
        `);

        try {
            this.arena.evalCode(code);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }

        if (resetMode === "preserveReactions") {
            this.pruneOverlappingGroupReactions(plan.groupReactions, "makePlan");
        }
        this.mergeTaskReactions(plan.taskReactions, "makePlan");
        this.mergeGroupReactions(plan.groupReactions, "makePlan");
        validateTransportPlan(army, plan);

        return plan;
    }

    public handlePlanEvent<EventType extends PlanEvent>(group: Group, event: EventType): Plan | null {
        console.log(`[Sandbox] handlePlanEvent: group=${group.id}, event=${event.type}`);
        const currentTask = group.getCurrentTask();
        const taskReactions = currentTask ? this.taskReactions.get(currentTask.id) : undefined;
        const groupReactions = this.groupReactions.get(group.id);

        if (currentTask) {
            console.log(`[Sandbox] Current task for group ${group.id}: ${currentTask.id} (${currentTask.type})`);
        } else {
            console.log(`[Sandbox] No current task for group ${group.id}`);
        }

        const taskReactionEntry = taskReactions?.[event.type];
        const groupReactionEntry = groupReactions?.[event.type];
        const reactionEntry = taskReactionEntry ?? groupReactionEntry;
        if (!reactionEntry) {
            console.log(`[Sandbox] No callback found for event ${event.type} (task override semantics).`);
            return null;
        }

        const callbackScope = taskReactionEntry ? "task" : "group";
        const callbackOwnerId = taskReactionEntry && currentTask ? currentTask.id : group.id;
        const jsCallback = this.getLiveCallback(reactionEntry, callbackScope, callbackOwnerId, event.type);
        if (!jsCallback) {
            this.deleteReactionEntry(callbackScope, callbackOwnerId, event.type);
            return null;
        }

        const plan: Plan = {
            queuedTasks: {},
            immediateTasks: {},
            clearGroupTasks: {},
            taskReactions: {},
            groupReactions: {},
        };
        const planGroup = translateToPlanGroup(plan, group);
        try {
            console.log(`[Sandbox] Executing callback for event ${event.type}`);
            jsCallback(event, planGroup);
            this.mergeTaskReactions(plan.taskReactions, "handlePlanEvent");
            this.mergeGroupReactions(plan.groupReactions, "handlePlanEvent");
            return plan;
        } catch (err) {
            console.error(`[Sandbox] Callback error on event ${event.type}:`, err);
            if (this.isReactionLifetimeError(err)) {
                console.warn(
                    `[Sandbox] Dropping stale ${callbackScope} reaction owner=${callbackOwnerId}, event=${event.type}.`,
                );
                this.deleteReactionEntry(callbackScope, callbackOwnerId, event.type);
            }
        }

        return null;
    }

    private mergeTaskReactions(taskReactions: Record<string, Record<string, any>>, source: string) {
        console.log(`[Sandbox] ${source}: task reactions object size=${Object.keys(taskReactions).length}`);
        for (const [taskId, planReactions] of Object.entries(taskReactions)) {
            if (!this.taskReactions.has(taskId)) {
                this.taskReactions.set(taskId, {});
            }

            const reactions = this.taskReactions.get(taskId) as Record<string, StoredReaction>;
            for (const [eventId, planReaction] of Object.entries(planReactions)) {
                reactions[eventId] = this.createStoredReaction(planReaction, "task", taskId, eventId);
                console.log(`[Sandbox] ${source}: set task reaction taskId=${taskId}, eventId=${eventId}`);
            }
        }
    }

    private mergeGroupReactions(groupReactions: Record<string, Record<string, any>>, source: string) {
        console.log(`[Sandbox] ${source}: group reactions object size=${Object.keys(groupReactions).length}`);
        for (const [groupId, planReactions] of Object.entries(groupReactions)) {
            if (!this.groupReactions.has(groupId)) {
                this.groupReactions.set(groupId, {});
            }

            const reactions = this.groupReactions.get(groupId) as Record<string, StoredReaction>;
            for (const [eventId, planReaction] of Object.entries(planReactions)) {
                reactions[eventId] = this.createStoredReaction(planReaction, "group", groupId, eventId);
                console.log(`[Sandbox] ${source}: set group reaction groupId=${groupId}, eventId=${eventId}`);
            }
        }
    }

    private pruneOverlappingGroupReactions(groupReactions: Record<string, Record<string, any>>, source: string) {
        for (const [groupId, incomingReactions] of Object.entries(groupReactions)) {
            const existingReactions = this.groupReactions.get(groupId);
            if (!existingReactions) {
                continue;
            }

            for (const eventId of Object.keys(incomingReactions)) {
                if (eventId in existingReactions) {
                    delete existingReactions[eventId];
                    console.log(`[Sandbox] ${source}: removed overlapping group reaction groupId=${groupId}, eventId=${eventId}`);
                }
            }
        }
    }

    private createStoredReaction(
        callbackOrDescriptor: any,
        scope: "task" | "group",
        ownerId: string,
        eventId: string,
    ): StoredReaction {
        const callback = this.extractReactionCallback(callbackOrDescriptor);
        const explicitSource = this.extractReactionSourceField(callbackOrDescriptor);
        return {
            callback: typeof callback === "function" ? callback : null,
            source: explicitSource ?? this.extractCallbackSource(callback, scope, ownerId, eventId),
        };
    }

    private extractReactionCallback(callbackOrDescriptor: any): any {
        if (callbackOrDescriptor && typeof callbackOrDescriptor === "object" && "callback" in callbackOrDescriptor) {
            return callbackOrDescriptor.callback;
        }
        return callbackOrDescriptor;
    }

    private extractReactionSourceField(callbackOrDescriptor: any): string | null {
        if (!callbackOrDescriptor || typeof callbackOrDescriptor !== "object") {
            return null;
        }
        if (typeof callbackOrDescriptor.__source === "string" && callbackOrDescriptor.__source.trim().length > 0) {
            return callbackOrDescriptor.__source;
        }
        if (typeof callbackOrDescriptor.source === "string" && callbackOrDescriptor.source.trim().length > 0) {
            return callbackOrDescriptor.source;
        }
        return null;
    }

    private extractCallbackSource(
        callback: any,
        scope: "task" | "group",
        ownerId: string,
        eventId: string,
    ): string | null {
        if (typeof callback !== "function") {
            console.warn(`[Sandbox] Cannot persist non-function ${scope} reaction owner=${ownerId}, event=${eventId}.`);
            return null;
        }
        try {
            const source = callback.toString().trim();
            if (!source || source.includes("[native code]")) {
                console.warn(`[Sandbox] Cannot serialize ${scope} reaction owner=${ownerId}, event=${eventId}.`);
                return null;
            }
            return source;
        } catch (err) {
            console.warn(`[Sandbox] Failed extracting callback source for ${scope} owner=${ownerId}, event=${eventId}:`, err);
            return null;
        }
    }

    private getLiveCallback(
        entry: StoredReaction,
        scope: "task" | "group",
        ownerId: string,
        eventId: string,
    ): ((event: PlanEvent, group: PlanGroup) => void) | null {
        if (typeof entry.callback === "function") {
            return entry.callback;
        }
        if (!entry.source) {
            console.warn(`[Sandbox] Missing callback source for ${scope} reaction owner=${ownerId}, event=${eventId}.`);
            return null;
        }
        try {
            const rehydrated = this.arena.evalCode(`(${entry.source})`);
            if (typeof rehydrated !== "function") {
                console.warn(`[Sandbox] Rehydrated ${scope} reaction is not callable owner=${ownerId}, event=${eventId}.`);
                return null;
            }
            entry.callback = rehydrated;
            return rehydrated;
        } catch (err) {
            console.warn(`[Sandbox] Failed to rehydrate ${scope} reaction owner=${ownerId}, event=${eventId}:`, err);
            return null;
        }
    }

    private rehydrateStoredReactions() {
        for (const [taskId, reactions] of this.taskReactions.entries()) {
            for (const [eventId, entry] of Object.entries(reactions)) {
                entry.callback = null;
                const callback = this.getLiveCallback(entry, "task", taskId, eventId);
                if (!callback) {
                    delete reactions[eventId];
                }
            }
        }
        for (const [groupId, reactions] of this.groupReactions.entries()) {
            for (const [eventId, entry] of Object.entries(reactions)) {
                entry.callback = null;
                const callback = this.getLiveCallback(entry, "group", groupId, eventId);
                if (!callback) {
                    delete reactions[eventId];
                }
            }
        }
    }

    private deleteReactionEntry(scope: "task" | "group", ownerId: string, eventId: string) {
        const reactionMap = scope === "task" ? this.taskReactions : this.groupReactions;
        const reactions = reactionMap.get(ownerId);
        if (!reactions) {
            return;
        }
        delete reactions[eventId];
        if (Object.keys(reactions).length === 0) {
            reactionMap.delete(ownerId);
        }
    }

    private isReactionLifetimeError(err: unknown): boolean {
        const message = err instanceof Error ? err.message : String(err);
        return message.includes("QuickJSUseAfterFree")
            || message.includes("Lifetime not alive")
            || message.includes("use-after-free");
    }


    public dispose() {
        this.arena.dispose();
    }
}

interface StoredReaction {
    source: string | null;
    callback: any;
}