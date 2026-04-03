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

        const planGroups: Record<string, PlanGroup> = {};
        for (const g of army.getGroups()) {
            planGroups[g.getName()] = translateToPlanGroup(g);
        }
        //const planGroups = army.getGroups().map(g => translateToPlanGroup(g));
        //const groupsScript = groups.map(g => `groups["${g.getName()}"] = new Group("${g.id}", "${g.getName()}");`).join('\n');

        let plan: Plan = {
            immediateTasks: {},
            queuedTasks: {}
        }

        this.arena.expose({
            addTaskToQueue: (jsTask: any) => {
                if (!jsTask.assignedGroupId) {
                    throw Error("Task must be assigned to a group")
                }
                const task = translateTask(jsTask);
                plan.queuedTasks[jsTask.assignedGroupId].push(task);
            },
            executeImmediately: (jsTask: any) => {
                const task = translateTask(jsTask);
                plan.immediateTasks[jsTask.assignedGroupId] = task;
            },
            groups: planGroups,
        });

        //this.arena.evalCode(groupsScript);

        try {
            this.arena.evalCode(code);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }

        return plan;
    }

    public handlePlanEvent<EventType extends PlanEvent>(group: Group, event: EventType): Task | null {
        const currentTask = group.getCurrentTask();
        if (!currentTask) { return null; }
        const reactions = this.taskReactions.get(currentTask.id);
        const planGroup = translateToPlanGroup(group);
        if (reactions && reactions[event.type]) {
            const jsCallback = reactions[event.type];
            try {
                // Execute the JS callback inside the Arena
                // Result might be a new Task object or null
                const result = jsCallback(event, planGroup);
                console.log(`[Sandbox] Executed js callback for event ${event.type}`);
                if (result) {
                    const newTask = translateTask(result);
                    // If the reaction returns a new task (e.g. Retreat)
                    if (result.reactions) {
                        console.log(`[Sandbox] Set new reactions for task ${newTask.id} (${newTask.type}).`);
                        this.taskReactions.set(newTask.id, result.reactions);
                    }
                    return newTask;
                }
            } catch (err) {
                console.error(`[Sandbox] Callback error on event ${event.type}:`, err);
            }
        }

        return null;
    }


    public listenToGroup(group: Group, army: Army) {
        group.subscribe((event) => {
            const orderEventName = this.mapEventToOrderName(event.type);
            if (!orderEventName) return;

            // 1. Identify the task currently being executed by the group
            const currentTask = group.getCurrentTask(); // You'll need this helper on your Group class
            if (!currentTask) return;

            const reactions = this.taskReactions.get(currentTask.id);
            if (reactions && reactions[orderEventName]) {
                const jsCallback = reactions[orderEventName];

                // 2. Wrap the group into a sandbox-safe PlanGroup for the callback
                const planGroup = this.translateToOrderGroup(group);

                try {
                    // 3. Execute the JS callback inside the Arena
                    // Result might be a new Task object or null
                    const result = jsCallback(event, planGroup);

                    if (result) {
                        // 4. If the reaction returns a new task (e.g. Retreat), 
                        // translate it and put it at the front of the queue
                        const newTask = this.translateTask(result, army, group);

                        // Logic: Clear current tasks and pivot to the reaction task
                        group.clearTasks();
                        group.addTaskToQueue(newTask);

                        console.log(`[Reactions] Pivot triggered: ${newTask.type}`);
                    }
                } catch (err) {
                    console.error(`[Sandbox] Callback error on event ${orderEventName}:`, err);
                }
            }
        });
    }

    public dispose() {
        this.arena.dispose();
    }
}