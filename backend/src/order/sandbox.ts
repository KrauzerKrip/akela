import { getQuickJS } from "quickjs-emscripten";
import { Arena } from "quickjs-emscripten-sync";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Army, Group, Push, Assault, Task, Waypoint, GameExecutor, addTaskToQueue, executeImmediately } from "../army";

export class OrderSandbox {
    private arena: Arena;

    private constructor(arena: Arena) {
        this.arena = arena;
    }

    public static async create(): Promise<OrderSandbox> {
        const QuickJS = await getQuickJS();
        const vm = QuickJS.newContext();

        const arena = new Arena(vm, { isMarshalable: "auto" });

        // QuickJS doesn't have 'global' out of the box, map it to globalThis
        arena.evalCode(`globalThis.global = globalThis;`);

        // Load bootstrap
        const bootstrapCode = fs.readFileSync(path.join(import.meta.dir, 'bootstrap.js'), 'utf8');
        arena.evalCode(bootstrapCode);

        return new OrderSandbox(arena);
    }

    private translateTask(jsTask: any, getGroupById: (id: string) => Group | undefined): Task {
        const type = jsTask.type;
        const teamId = jsTask.assignedTeamId;
        const group = getGroupById(teamId);
        if (!group) {
            throw new Error(`Group not found for teamId: ${teamId}`);
        }

        const jsWaypoints: any[] = jsTask.waypoints;
        const waypoints: Waypoint[] = jsWaypoints.map((wp: any) => ({
            id: uuidv4(),
            position: { x: wp.x, y: wp.y, z: 0 },
            completionCallback: () => { }
        }));

        if (type === 'PUSH') {
            return new Push(uuidv4(), group, waypoints);
        } else if (type === 'ASSAULT') {
            return new Assault(uuidv4(), group, waypoints);
        } else {
            throw new Error(`Unknown task type: ${type}`);
        }
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