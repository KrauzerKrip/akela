import { PlanSandbox } from "./sandbox";
import { Army, Group, GameExecutor, Waypoint, UnitKilledEvent, Unit, GameEventDispatcher, EngineGroupEvent, Loadout } from "../army";
import * as fs from "fs";
import * as path from "path";
import { KiaPlanEvent } from "./models";

class DummyExecutor implements GameExecutor {
    getGroups(side: string): Promise<Group[]> {
        throw new Error("Method not implemented.");
    }
    getGroupUnits(group: Group): Promise<Unit[]> {
        throw new Error("Method not implemented.");
    }
    getUnitLoadout(unit: Unit): Promise<Loadout> {
        throw new Error("Method not implemented.");
    }
    getWaypoints(group: Group): Promise<Waypoint[]> {
        throw new Error("Method not implemented.");
    }
    addGroupEventHandlers(group: Group): Promise<void> {
        throw new Error("Method not implemented.");
    }
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

type GroupEventHandler = (event: EngineGroupEvent) => void;

class DummyEventDispatcher implements GameEventDispatcher {
    private eventHandlers: Map<string, Map<string, GroupEventHandler>> = new Map<string, Map<string, GroupEventHandler>>;

    public fireGroupEvent(event: EngineGroupEvent) {
        let groupHandlers = this.eventHandlers.get(event.groupId);
        if (groupHandlers) {
            let handler = groupHandlers.get(event.type);
            if (handler) {
                handler(event);
            }
        }
    }

    public addGroupHandler<EventType extends EngineGroupEvent>(group: Group, eventType: string, callback: (event: EventType) => void): void {
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
            weapons: {
                primary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
                secondary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
            }
        }, []);
        const unitB = new Unit(`unitB_${i}_id`, `Unit Bravo ${i}`, {
            weapons: {
                primary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
                secondary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
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
    const plan = await sandbox.makePlan(army, code);
    const groups = army.getGroups();

    // We store the promises but do NOT await them immediately if they are 
    // long-running tasks (like Push or Wait). If we await them here, the script 
    // pauses, and we can never fire the simulated KIA event below!
    const immediateTaskPromises = [];
    console.log(plan);

    for (const group of groups) {
        if (plan.queuedTasks[group.id]) {
            plan.queuedTasks[group.id].forEach((task) => {
                // This naturally triggers group.executeNext() in the background
                group.addTaskToQueue(task);
            });
        }
        if (plan.immediateTasks[group.id]) {
            immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
        }
    }

    console.log("--- Execution Results ---");
    // Get the real queue length from the Group object, not the static plan payload
    console.log("Alpha taskQueue length:", alpha.taskQueue.length);

    // Let the event loop breathe a tick so immediate tasks can establish their event listeners
    await new Promise(resolve => setTimeout(resolve, 0));

    console.log("Simulating KIA event with >0.5 casualties...");

    const event: UnitKilledEvent = { groupId: alpha.id, type: "UNIT_KILLED", unitId: "unitA_1_id" };
    const planEvent: KiaPlanEvent = { type: "KIA" }; // Assuming your sandbox mapper needs this

    // Fire the event! If an active task is listening for it, it will react.
    eventDispatcher.fireGroupEvent(event);

    // Pass the domain event to your sandbox to generate a reactionary plan
    const newPlan = sandbox.handlePlanEvent(alpha, planEvent);

    if (newPlan) {
        console.log("New plan received from sandbox:", newPlan);

        // 1. Wipe current operations if the sandbox demands it
        if (newPlan.clearGroupTasks[alpha.id]) {
            alpha.clearTasks(); // Wipes activeTask and empties taskQueue
        }
        if (newPlan.clearGroupTasks[bravo.id]) {
            bravo.clearTasks();
        }

        // 2. Fire immediate override tasks (e.g., Retreat or Report)
        if (newPlan.immediateTasks[alpha.id]) {
            // Note: Not awaiting this so the test can finish, unless it's an instant resolve like Report
            alpha.executeImmediately(newPlan.immediateTasks[alpha.id]);
        }

        // 3. Queue new tasks
        // We DO NOT call executeNext() manually. `addTaskToQueue` will automatically kickstart the queue.
        if (newPlan.queuedTasks && newPlan.queuedTasks[alpha.id]) {
            newPlan.queuedTasks[alpha.id].forEach(task => alpha.addTaskToQueue(task));
        }

    } else {
        console.log("New plan is null (no reaction triggered)");
    }
}

test().catch(console.error);
