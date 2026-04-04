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
    const bravo = new Group("bravo-id", "Bravo", executor);
    alpha.setupEventHandlers(eventDispatcher);
    bravo.setupEventHandlers(eventDispatcher);
    for (let i = 0; i < 4; i++) {
        const unitA = new Unit(`unitA_${i}_id`, `Unit Alpha ${i}`, {
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
        const unitB = new Unit(`unitB_${i}_id`, `Unit Bravo ${i}`, {
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
        alpha.addUnit(unitA);
        bravo.addUnit(unitB);
    }

    army.addGroup(alpha);
    army.addGroup(bravo);

    const sandbox = await PlanSandbox.create();

    console.log("Reading example.js...");
    const code = fs.readFileSync(path.join(import.meta.dir, "example.js"), 'utf-8');

    console.log("Making plan...");
    const plan = sandbox.makePlan(army, code);
    const groups = army.getGroups();
    const immediateTaskPromises = [];
    for (const group of groups) {
        if (plan.queuedTasks[group.id]) {
            plan.queuedTasks[group.id].forEach((task, index, tasks) => {
                group.addTaskToQueue(task);
            });
        }
        if (plan.immediateTasks[group.id]) {
            immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
        }
    }

    await Promise.all(immediateTaskPromises);

    console.log("--- Execution Results ---");
    console.log("taskQueue length:", plan.queuedTasks[alpha.id].length);
    if (plan.queuedTasks[alpha.id].length > 0) {
        const task = plan.queuedTasks[alpha.id][0];
        console.log("Task in queue type:", (task).constructor.name);
        console.log("Simulating KIA event with >0.5 casualties...");
        alpha.addTaskToQueue(task);
        const event: UnitKilledEvent = { groupId: alpha.id, type: "UNIT_KILLED", unitId: "unitA_1_id" };
        const planEvent: KiaPlanEvent = { type: "KIA" };
        eventDispatcher.fireGroupEvent(event);
        const newPlan = sandbox.handlePlanEvent(alpha, planEvent);
        if (newPlan) {
            console.log("New plan:", newPlan);
            if (newPlan.clearGroupTasks[alpha.id]) {
                alpha.clearTasks();
            }
            if (newPlan.clearGroupTasks[bravo.id]) {
                bravo.clearTasks();
            }
            await alpha.executeImmediately(newPlan.immediateTasks[alpha.id]);
            await alpha.completeCurrentTask();
        } else {
            console.log("New plan is null");
        }
    }
}

test().catch(console.error);
