import ivm from "isolated-vm";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Army, Group, Push, Assault, Task, Waypoint, GameExecutor, addTaskToQueue, executeImmediately } from "../army";

export class OrderSandbox {
    private isolate: ivm.Isolate;
    private context: ivm.Context;
    private jail: ivm.Reference<Record<string, any>>;

    constructor() {
        this.isolate = new ivm.Isolate({ memoryLimit: 128 });
        this.context = this.isolate.createContextSync();
        this.jail = this.context.global;
        this.jail.setSync('global', this.jail.derefInto());

        // We also need to expose 'ivm' to the bootstrap file, so it can use ivm.Reference
        this.jail.setSync('ivm', ivm);

        // Load bootstrap
        const bootstrapCode = fs.readFileSync(path.join(import.meta.dir, 'bootstrap.js'), 'utf8');
        this.isolate.compileScriptSync(bootstrapCode).runSync(this.context);
    }

    private translateTask(taskRef: ivm.Reference<any>, getGroupById: (id: string) => Group | undefined): Task {
        const type = taskRef.getSync('type');
        const teamId = taskRef.getSync('assignedTeamId');
        const group = getGroupById(teamId);
        if (!group) {
            throw new Error(`Group not found for teamId: ${teamId}`);
        }

        const jsWaypoints: any[] = taskRef.getSync('waypoints');
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
        const groups = (army as any).groups as Group[]; // Dirty trick to get groups if private
        const teamsScript = groups.map(g => `teams["${g.getName()}"] = new Team("${g.id}", "${g.getName()}");`).join('\n');
        this.isolate.compileScriptSync(teamsScript).runSync(this.context);

        // Map TS callbacks
        this.jail.setSync('_addTaskCallback', new ivm.Reference((taskRef: ivm.Reference<any>) => {
            const task = this.translateTask(taskRef, (id) => army.getGroupById(id));
            addTaskToQueue(task);
        }));

        this.jail.setSync('_executeCallback', new ivm.Reference((taskRef: ivm.Reference<any>) => {
            const task = this.translateTask(taskRef, (id) => army.getGroupById(id));
            executeImmediately(task, executor);
        }));

        try {
            this.isolate.compileScriptSync(code).runSync(this.context);
        } catch (e) {
            console.error("Error executing script inside sandbox:", e);
            throw e;
        }
    }
}