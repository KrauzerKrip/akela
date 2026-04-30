import { describe, expect, it } from "bun:test";
import {
    Assault,
    Embark,
    GameExecutor,
    Group,
    GroupEvent,
    Push,
    Report,
    Signal,
    Task,
    Vehicle,
    WaitTask
} from "./army";

function createExecutorMock(): GameExecutor & { __ops: string[] } {
    const operations: string[] = [];
    return {
        getGroupBuilders: async () => [],
        getGroupUnits: async () => [],
        getUnitLoadout: async () => ({ weapons: { primary: { base: null, sight: null, ammo: { type: "", quantity: 0 }, description: null }, secondary: { base: null, sight: null, ammo: { type: "", quantity: 0 }, description: null } } }),
        addWaypoint: async () => { },
        getWaypoints: async () => [],
        getGroupAssignedVehicles: async () => [],
        setCombatMode: async () => { },
        setCombatBehaviour: async () => { },
        setGroupId: async () => { },
        setFormation: async () => { },
        addGroupEventHandlers: async () => { },
        getGroupLeaderPosition: async () => ({ x: 0, y: 0, z: 0 }),
        commandLoad: async () => { },
        commandUnload: async () => { },
        stopGroup: async () => { operations.push("stopGroup"); },
        clearGroupWaypoints: async () => { operations.push("clearGroupWaypoints"); },
        __ops: operations,
    };
}

function createGroup(): Group {
    const session = { getId: () => "test-session" } as any;
    return new Group("g1", "Alpha", session, createExecutorMock());
}

class HangingTask extends Task {
    constructor(name: string) {
        super("hanging-task", "TEST_HANG", name);
    }

    public async execute(): Promise<void> {
        await new Promise<void>(() => { });
    }
}

describe("Group task execution", () => {
    it("resolves WaitTask when a propagated signal is received", async () => {
        const group = createGroup();
        const signal: Signal = { id: "sig-1", name: "Signal 1" };
        const task = WaitTask.fromSignal(signal, "wait-for-signal");

        const execution = task.execute(group, createExecutorMock());
        await group.receiveSignal(signal);

        await expect(execution).resolves.toBeUndefined();
    });

    it("resolves Embark on EMBARKING_COMPLETE event", async () => {
        const group = createGroup();
        const vehicle: Vehicle = { id: "veh-1", name: "APC" };
        const task = Embark.fromVehicle(vehicle, "embark-apc");

        const execution = task.execute(group, createExecutorMock());
        group.emitDomainEvent({
            source: "GAME",
            type: "EMBARKING_COMPLETE",
            groupId: group.id,
            vehicleId: vehicle.id,
            status: "Complete"
        } as GroupEvent);

        await expect(execution).resolves.toBeUndefined();
    });

    it("preempts a hanging active task with executeImmediately", async () => {
        const group = createGroup();
        const events: GroupEvent[] = [];
        group.subscribe((event) => {
            events.push(event);
        });

        group.addTaskToQueue(new HangingTask("blocked-task"));

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(group.getCurrentTask()?.name).toBe("blocked-task");

        await group.executeImmediately(Report.fromMessage("Immediate report", "report-now"));

        const startedNames = events
            .filter((event) => event.type === "TASK_STARTED")
            .map((event) => (event as any).task.name);
        const completedNames = events
            .filter((event) => event.type === "TASK_COMPLETED")
            .map((event) => (event as any).task.name);

        expect(startedNames).toContain("blocked-task");
        expect(startedNames).toContain("report-now");
        expect(completedNames).toContain("report-now");
        expect(completedNames).not.toContain("blocked-task");
    });

    it("cancels active movement task during immediate preemption", async () => {
        const executor = createExecutorMock() as GameExecutor & { __ops: string[] };
        const session = { getId: () => "test-session" } as any;
        const group = new Group("g1", "Alpha", session, executor);

        const movementTask = Push.fromWaypoints([
            { id: "wp-1", position: { x: 10, y: 10 } }
        ], "push-to-a");
        group.addTaskToQueue(movementTask);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(group.getCurrentTask()?.name).toBe("push-to-a");

        await group.executeImmediately(Report.fromMessage("override", "report-now"));

        expect(executor.__ops).toEqual(["clearGroupWaypoints"]);
    });

    it("cancels active movement task when clearing tasks", async () => {
        const executor = createExecutorMock() as GameExecutor & { __ops: string[] };
        const session = { getId: () => "test-session" } as any;
        const group = new Group("g1", "Alpha", session, executor);

        const movementTask = Assault.fromWaypoints([
            { id: "wp-1", position: { x: 10, y: 10 } }
        ], "assault-a");
        group.addTaskToQueue(movementTask);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(group.getCurrentTask()?.name).toBe("assault-a");

        await group.clearTasks();

        expect(executor.__ops).toEqual(["clearGroupWaypoints"]);
        expect(group.getCurrentTask()).toBeNull();
        expect(group.taskQueue.length).toBe(0);
    });

    it("uses no-op cancel for non-movement tasks", async () => {
        const executor = createExecutorMock() as GameExecutor & { __ops: string[] };
        const session = { getId: () => "test-session" } as any;
        const group = new Group("g1", "Alpha", session, executor);
        const signal: Signal = { id: "sig-1", name: "Signal 1" };

        const waitingTask = WaitTask.fromSignal(signal, "wait-here");
        group.addTaskToQueue(waitingTask);
        await new Promise((resolve) => setTimeout(resolve, 0));
        await group.clearTasks();

        expect(executor.__ops.length).toBe(0);
    });
});
