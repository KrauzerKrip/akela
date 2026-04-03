import { PlanSandbox } from "./sandbox";
import { Army, Group, GameExecutor, Waypoint, UnitKilledEvent } from "../army";
import * as fs from "fs";
import * as path from "path";

class DummyExecutor implements GameExecutor {
    async addWaypoint(group: Group, waypoint: Waypoint) {
        console.log(`[Executor] addWaypoint to ${group.getName()}: (${waypoint.position.x}, ${waypoint.position.y})`);
    }
    async getGroupAssignedVehicles(group: Group) { return []; }
    async setCombatMode(group: Group, mode: string) {
        console.log(`[Executor] setCombatMode for ${group.getName()}: ${mode}`);
    }
    async setCombatBehaviour(group: Group, behaviour: string) { }
    async setGroupId(group: Group, name: string) { }
    async setFormation(group: Group, formation: string) { }
}

async function test() {
    console.log("Setting up Army...");
    const army = new Army("WEST");
    const alpha = new Group("alpha-id", "Alpha");
    army.addGroup(alpha);
    army.addGroup(new Group("bravo-id", "Bravo"));

    const executor = new DummyExecutor();
    const sandbox = await PlanSandbox.create();
    sandbox.listenToGroup(alpha);

    console.log("Reading example.js...");
    const code = fs.readFileSync(path.join(import.meta.dir, "example.js"), 'utf-8');

    console.log("Executing script...");
    sandbox.executeScript(code, army, executor);

    console.log("--- Execution Results ---");
    console.log("taskQueue length:", alpha.taskQueue.length);
    if (alpha.taskQueue.length > 0) {
        console.log("Task in queue type:", (alpha.taskQueue[0] as any).constructor.name);
        console.log("Assigned group ID:", (alpha.taskQueue[0] as any).group.id);

        console.log("Simulating KIA event with >0.5 casualties...");
        const event: UnitKilledEvent = { type: 'UNIT_KILLED', groupId: alpha.id, unitId: 'unit-x' };
        (alpha as any).emitDomainEvent(event);
        console.log("taskQueue length after event:", alpha.taskQueue.length);
        if (alpha.taskQueue.length > 1) {
            console.log("New task in queue type:", (alpha.taskQueue[1] as any).constructor.name);
        }
    }
}

test().catch(console.error);
