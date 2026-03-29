import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Army, Group, Push, Assault, Retreat, Report, Task, Waypoint, GameExecutor, addTaskToQueue, executeImmediately } from "../army";

export class OrderSandbox {
    private arena: Arena;

    private constructor(arena: Arena) {
        this.arena = arena;
    }

    public static async create(): Promise<OrderSandbox> {
        const QuickJS = await getQuickJS();
        const vm = QuickJS.newContext();

        const arena = new Arena(vm, { isMarshalable: true });

        // QuickJS doesn't have 'global' out of the box, map it to globalThis
        arena.evalCode(`globalThis.global = globalThis;`);

        // Load bootstrap
        const bootstrapCode = fs.readFileSync(path.join(import.meta.dir, 'bootstrap.js'), 'utf8');
        arena.evalCode(bootstrapCode);

        return new OrderSandbox(arena);
    }

    private translateTask(jsTask: any, getGroupById: (id: string) => Group | undefined, contextGroup?: Group): Task {
        const type = jsTask.type;
        const teamId = jsTask.assignedTeamId;
        const group = (teamId ? getGroupById(teamId) : contextGroup);
        if (!group) {
            throw new Error(`Group not found for teamId: ${teamId} / type: ${type}`);
        }

        let task: Task;
        if (type === 'PUSH') {
            const waypoints = jsTask.waypoints.map((wp: any) => ({
                id: uuidv4(),
                position: { x: wp.x, y: wp.y, z: 0 },
                completionCallback: () => { }
            }));
            task = new Push(uuidv4(), group, waypoints);
        } else if (type === 'ASSAULT') {
            const waypoints = jsTask.waypoints.map((wp: any) => ({
                id: uuidv4(),
                position: { x: wp.x, y: wp.y, z: 0 },
                completionCallback: () => { }
            }));
            task = new Assault(uuidv4(), group, waypoints);
        } else if (type === 'RETREAT') {
            task = new Retreat(uuidv4(), group);
        } else if (type === 'REPORT') {
            task = new Report(uuidv4(), group, jsTask.msg);
        } else {
            throw new Error(`Unknown task type: ${type}`);
        }

        const jsReactions = jsTask.reactions;
        if (jsReactions) {
            for (const eventName of Object.keys(jsReactions)) {
                task.reactions[eventName] = (event: string, team: any) => {
                    const cb = jsReactions[eventName];
                    const result = cb(event, team);
                    if (result) {
                        return this.translateTask(result, getGroupById, group);
                    }
                    return undefined;
                };
            }
        }
        return task;
    }

    public executeScript(code: string, army: Army, executor: GameExecutor) {
        // Expose groups as teams
        const groups = (army as any).groups as Group[];

        this.arena.expose({
            _addTaskCallback: (jsTask: any) => {
                const task = this.translateTask(jsTask, (id) => army.getGroupById(id));
                addTaskToQueue(task);
            },
            _executeCallback: (jsTask: any) => {
                const task = this.translateTask(jsTask, (id) => army.getGroupById(id));
                executeImmediately(task, executor);
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