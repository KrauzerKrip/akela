import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Army, Group, Push, Assault, Retreat, Report, Task, Waypoint, GameExecutor, SequenceTask } from "../army";
import { PlanEvent, PlanGroup, Plan } from "./models";
import { Point } from "../geography";

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

    private translateTask(jsTask: any, army: Army): Task {
        const type: string = jsTask.type;
        const name: string = jsTask.name;
        // Fallback to contextGroup if no teamId is explicitly provided in the task
        if (!jsTask.assignedGroupId) {
            throw Error("Task must be assigned to a group")
        }

        let task: Task;
        switch (type) {
            case 'PUSH':
            case 'ASSAULT':
                const waypoints = jsTask.waypoints.map((wp: any) => ({
                    id: uuidv4(),
                    position: { x: wp.x, y: wp.y, } as Point
                } as Waypoint));
                task = type === 'PUSH'
                    ? Push.fromWaypoints(waypoints, name)
                    : Assault.fromWaypoints(waypoints, name);
                break;

            case 'SEQUENCE':
                // Recursively translate children
                const children = jsTask.tasks.map((t: any) => this.translateTask(t, army));
                task = SequenceTask.fromTasks(children, name);
                break;

            case 'RETREAT':
                task = Retreat.create(name);
                break;

            default:
                task = new Report(uuidv4(), "Report", jsTask.msg || "No message");
        }

        // Store reactions for the host to trigger later
        if (jsTask.reactions) {
            this.taskReactions.set(task.id, jsTask.reactions);
        }

        return task;
    }

    private translateToOrderGroup(group: Group): PlanGroup {
        return {
            getCasualties() {
                return group.getCasualties();
            },
            getCasualtyRatio() {
                return group.getCasualtyRatio();
            },
            getAliveUnitCount() {
                return group.getAliveUnitCount();
            }
        }
    }


    public makePlan(army: Army, code: string): Plan {
        console.log(`[Sandbox] Making plan for army...`);

        const groups = army.getGroups();
        const groupsScript = groups.map(g => `groups["${g.getName()}"] = new Group("${g.id}", "${g.getName()}");`).join('\n');

        let plan: Plan = {
            immediateTasks: {},
            queuedTasks: {}
        }

        this.arena.expose({
            addTaskCallback: (jsTask: any) => {
                if (!jsTask.assignedGroupId) {
                    throw Error("Task must be assigned to a group")
                }
                const task = this.translateTask(jsTask, army);
                plan.queuedTasks[jsTask.assignedGroupId].push(task);
            },
            executeCallback: (jsTask: any) => {
                const task = this.translateTask(jsTask, army);
                plan.immediateTasks[jsTask.assignedGroupId] = task;
            }
        });

        this.arena.evalCode(groupsScript);

        try {
            this.arena.evalCode(code);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }

        return plan;
    }

    public handlePlanEvent<EventType extends PlanEvent>(event: EventType) {

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

    private mapEventToOrderName(type: string): string | null {
        const mapping: Record<string, string> = {
            'UNIT_KILLED': 'KIA',
            'WAYPOINT_COMPLETE': 'TASK_COMPLETE',
            'ENEMY_DETECTED': 'NEW_CONTACT'
        };
        return mapping[type] || null;
    }

    public executeScript(code: string, army: Army, executor: GameExecutor) {
        console.log(`[Sandbox] Executing script for army...`);
        // Expose groups as teams
        const groups = (army as any).groups as Group[];

        this.arena.expose({
            addTaskCallback: (jsTask: any) => {
                const task = this.translateTask(jsTask, (id) => army.getGroupById(id));
                (task as any).group.addTaskToQueue(task);
            },
            _executeCallback: (jsTask: any) => {
                const task = this.translateTask(jsTask, (id) => army.getGroupById(id));
                (task as any).group.executeImmediately(task, executor);
            }
        });

        const teamsScript = groups.map(g => `teams["${g.getName()}"] = new Team("${g.id}", "${g.getName()}");`).join('\n');
        this.arena.evalCode(teamsScript);

        try {
            this.arena.evalCode(code);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }
    }

    public dispose() {
        this.arena.dispose();
    }
}