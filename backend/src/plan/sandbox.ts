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
    private arena: Arena;
    private taskReactions = new Map<string, Record<string, any>>();

    private constructor(arena: Arena) {
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

        return new PlanSandbox(arena);
    }


    public makePlan(army: Army, code: string): Plan {
        console.log(`[Sandbox] Making plan for army...`);

        let plan: Plan = {
            immediateTasks: {},
            queuedTasks: {},
            clearGroupTasks: {},
            taskReactions: {}
        }

        const planGroups: Record<string, PlanGroup> = {};
        for (const g of army.getGroups()) {
            planGroups[g.getName()] = translateToPlanGroup(plan, g);
            plan.clearGroupTasks[g.id] = false;
        }

        this.arena.expose({
            groups: planGroups,
        });

        try {
            this.arena.evalCode(code);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }

        for (const [taskId, planReactions] of Object.entries(plan.taskReactions)) {
            console.log(`Found reactions for taskId ${taskId}`);
            if (!this.taskReactions.has(taskId)) {
                this.taskReactions.set(taskId, {});
            }
            // "if" above ensures there is a record for this taskId so we can use "as" to hide the compiler error.
            const reactions = this.taskReactions.get(taskId) as Record<string, any>;
            for (const [eventId, planReaction] of Object.entries(planReactions)) {
                reactions[eventId] = planReaction;
            }
        }

        return plan;
    }

    public handlePlanEvent<EventType extends PlanEvent>(group: Group, event: EventType): Plan | null {
        console.log(`[Sandbox] handlePlanEvent: group=${group.id}, event=${event.type}`);
        const currentTask = group.getCurrentTask();
        if (!currentTask) {
            console.log(`[Sandbox] No current task for group ${group.id}`);
            return null;
        }
        console.log(`[Sandbox] Current task for group ${group.id}: ${currentTask.id} (${currentTask.type})`);

        const reactions = this.taskReactions.get(currentTask.id);
        if (reactions) {
            console.log(`[Sandbox] Found reactions for task ${currentTask.id}: ${Object.keys(reactions).join(", ")}`);
        } else {
            console.log(`[Sandbox] No reactions found for task ${currentTask.id}`);
        }

        const plan: Plan = {
            queuedTasks: {},
            immediateTasks: {},
            clearGroupTasks: {},
            taskReactions: {}
        };
        const planGroup = translateToPlanGroup(plan, group);
        if (reactions && reactions[event.type]) {
            const jsCallback = reactions[event.type];
            try {
                console.log(`[Sandbox] Executing js callback for event ${event.type}`);
                // Execute the JS callback inside the Arena
                // Result might be a new Task object or null
                jsCallback(event, planGroup);
                for (const [taskId, planReactions] of Object.entries(plan.taskReactions)) {
                    if (!this.taskReactions.has(taskId)) {
                        this.taskReactions.set(taskId, {});
                    }
                    // "if" above ensures there is a record for this taskId so we can use "as" to hide the compiler error.
                    const reactions = this.taskReactions.get(taskId) as Record<string, any>;
                    for (const [eventId, planReaction] of Object.entries(planReactions)) {
                        reactions[eventId] = planReaction;
                    }
                }
                return plan;
            } catch (err) {
                console.error(`[Sandbox] Callback error on event ${event.type}:`, err);
            }
        } else if (reactions) {
            console.log(`[Sandbox] No specific callback for event type ${event.type}`);
        }

        return null;
    }


    public dispose() {
        this.arena.dispose();
    }
}