import { PlanSandbox } from "./sandbox";
import { Army, Group, GameExecutor, Waypoint, UnitKilledEvent, Unit, GameEventDispatcher, GroupEvent } from "../army";
import * as fs from "fs";
import * as path from "path";
import { KiaPlanEvent } from "./models";

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

type GroupEventHandler = (event: GroupEvent) => void;

class DummyEventDispatcher implements GameEventDispatcher {
    private eventHandlers: Map<string, Map<string, GroupEventHandler>> = new Map<string, Map<string, GroupEventHandler>>;

    public fireGroupEvent(event: GroupEvent) {
        let groupHandlers = this.eventHandlers.get(event.groupId);
        if (groupHandlers) {
            let handler = groupHandlers.get(event.type);
            if (handler) {
                handler(event);
            }
        }
    }

    public addGroupHandler<EventType extends GroupEvent>(group: Group, eventType: string, callback: (event: EventType) => void): void {
        if (!this.eventHandlers.has(group.id)) {
            this.eventHandlers.set(group.id, new Map<string, GroupEventHandler>());
        }
        const groupEventHandlers = this.eventHandlers.get(group.id);
        groupEventHandlers?.set(eventType, callback as GroupEventHandler);
    }
}

async function test() {
    console.log("Setting up Army...");
    const executor = new DummyExecutor();
    const eventDispatcher = new DummyEventDispatcher();
    const army = new Army("BLUFOR");
    const alpha = new Group("alpha-id", "Alpha", executor);
    alpha.setupEventHandlers(eventDispatcher);
    for (let i = 0; i < 4; i++) {
        const unit = new Unit(`unit_${i}_id`, `Unit ${i}`, {
            weapons:
            {
                primary:
                {
                    ammo:
                        { type: "cool ammo", quantity: 30 },
                    base: "base",
                    description: "cool weapon",
                    sight: "cool sight"
                },
                secondary: {
                    ammo:
                        { type: "cool ammo", quantity: 30 },
                    base: "base",
                    description: "cool weapon",
                    sight: "cool sight"
                },
            }
        }, []);

        alpha.addUnit(unit);
    }

    army.addGroup(alpha);
    army.addGroup(new Group("bravo-id", "Bravo", executor));

    const sandbox = await PlanSandbox.create();

    console.log("Reading example.js...");
    const code = fs.readFileSync(path.join(import.meta.dir, "example.js"), 'utf-8');

    console.log("Making plan...");
    const plan = sandbox.makePlan(army, code);

    const groups = army.getGroups();
    const immediateTaskPromises = [];
    for (const group of groups) {
        plan.queuedTasks[group.id].forEach((task, index, tasks) => {
            group.addTaskToQueue(task);
        });
        immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
    }

    await Promise.all(immediateTaskPromises);

    console.log("--- Execution Results ---");
    console.log("taskQueue length:", alpha.taskQueue.length);
    if (alpha.taskQueue.length > 0) {
        console.log("Task in queue type:", (alpha.taskQueue[0] as any).constructor.name);
        console.log("Assigned group ID:", (alpha.taskQueue[0] as any).group.id);

        console.log("Simulating KIA event with >0.5 casualties...");
        const event: UnitKilledEvent = { groupId: alpha.id, type: "UNIT_KILLED", unitId: "unit_1_id" };
        const planEvent: KiaPlanEvent = { type: "KIA" };
        eventDispatcher.fireGroupEvent(event);
        const task = sandbox.handlePlanEvent(alpha, planEvent);
        if (task) {
            console.log("New task type:", (task).constructor.name);
        } else {
            console.log("New task is null");
        }
    }
}

test().catch(console.error);
