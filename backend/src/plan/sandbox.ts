import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Army, Group, Push, Assault, Retreat, Report, Task, Waypoint, GameExecutor, SequenceTask } from "../army";
import { PlanEvent, PlanGroup, Plan } from "./models";
import { Point } from "../geography";
import { translateTask, translateToPlanGroup } from "./translation";

export class PlanSandbox {
    private quickJS: any;
    private arena: Arena;
    private taskReactions = new Map<string, Record<string, any>>();
    private groupReactions = new Map<string, Record<string, any>>();

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

    public async reset() {
        if (this.arena) {
            this.arena.dispose();
        }
        const vm = this.quickJS.newContext();
        this.arena = new Arena(vm, { isMarshalable: true });
        this.arena.evalCode(`globalThis.global = globalThis;`);
        const bootstrapCode = fs.readFileSync(path.join(import.meta.dir, 'bootstrap.js'), 'utf8');
        this.arena.evalCode(bootstrapCode);
        this.taskReactions.clear();
        this.groupReactions.clear();
    }

    public async makePlan(army: Army, code: string): Promise<Plan> {
        await this.reset();
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

        try {
            this.arena.evalCode(code);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }

        this.mergeTaskReactions(plan.taskReactions, "makePlan");
        this.mergeGroupReactions(plan.groupReactions, "makePlan");

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

        const jsCallback = taskReactions?.[event.type] ?? groupReactions?.[event.type];
        if (!jsCallback) {
            console.log(`[Sandbox] No callback found for event ${event.type} (task override semantics).`);
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
        }

        return null;
    }

    private mergeTaskReactions(taskReactions: Record<string, Record<string, any>>, source: string) {
        console.log(`[Sandbox] ${source}: task reactions object size=${Object.keys(taskReactions).length}`);
        for (const [taskId, planReactions] of Object.entries(taskReactions)) {
            if (!this.taskReactions.has(taskId)) {
                this.taskReactions.set(taskId, {});
            }

            const reactions = this.taskReactions.get(taskId) as Record<string, any>;
            for (const [eventId, planReaction] of Object.entries(planReactions)) {
                reactions[eventId] = planReaction;
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

            const reactions = this.groupReactions.get(groupId) as Record<string, any>;
            for (const [eventId, planReaction] of Object.entries(planReactions)) {
                reactions[eventId] = planReaction;
                console.log(`[Sandbox] ${source}: set group reaction groupId=${groupId}, eventId=${eventId}`);
            }
        }
    }


    public dispose() {
        this.arena.dispose();
    }
}