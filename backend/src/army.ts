import { Point, Point3D } from "./geography";
import { v4 as uuidv4 } from 'uuid';

export interface Event {
    type: string;
}

export interface GroupEvent extends Event {
    groupId: string;
}

export interface ReportGroupEvent extends GroupEvent {
    type: "REPORT";
    message: string;
}

export interface EngineGroupEvent extends GroupEvent { }

export interface UnitKilledEvent extends EngineGroupEvent {
    type: "UNIT_KILLED";
    unitId: string;
    // fields "killer" and "instigator" omitted because the current domain model doesn't require them
}

export interface EnemyDetectedEvent extends EngineGroupEvent {
    type: "ENEMY_DETECTED";
    newTargetId?: string;
    position: Point3D;
    kind: string;
}

export interface WaypointCompleteEvent extends EngineGroupEvent {
    type: "WAYPOINT_COMPLETE";
    waypointId: string;
}

export interface CombatModeChangedEvent extends EngineGroupEvent {
    type: "COMBAT_MODE_CHANGED";
    newMode: string;
}

export interface TaskCompleteEvent extends EngineGroupEvent {
    type: "TASK_COMPLETE";
    taskId: string;
}

export interface SignalEvent extends EngineGroupEvent {
    type: "SIGNAL",
    signal: Signal;
}

export interface TacticalGroupEvent extends GroupEvent {
    groupId: string;
}

export interface EnemyContactEvent extends TacticalGroupEvent {
    type: "ENEMY_CONTACT";
    targetIds: string[];
    contactCount: number;
    kind: string;
}

export interface EngagedInCombatEvent extends TacticalGroupEvent {
    type: "ENGAGED_IN_COMBAT";
}

export interface CombatEndedEvent extends TacticalGroupEvent {
    type: "COMBAT_ENDED";
}

export interface KIA extends TacticalGroupEvent {
    type: "KIA";
}

export interface TacticalReportEvent extends TacticalGroupEvent {
    type: "TACTICAL_REPORT";
    message: string;
}

export interface Signal {
    id: string;
    name: string;
}

export interface GameExecutor {
    getGroups(side: string): Promise<Group[]>;
    getGroupUnits(group: Group): Promise<Unit[]>;
    getUnitLoadout(unit: Unit): Promise<Loadout>;
    addWaypoint(group: Group, waypoint: Waypoint): Promise<void>;
    getWaypoints(group: Group): Promise<Waypoint[]>;
    getGroupAssignedVehicles(group: Group): Promise<Vehicle[]>;
    setCombatMode(group: Group, mode: string): Promise<void>;
    setCombatBehaviour(group: Group, behaviour: string): Promise<void>;
    setGroupId(group: Group, name: string): Promise<void>;
    setFormation(group: Group, formation: string): Promise<void>;
    addGroupEventHandlers(group: Group): Promise<void>;
    getGroupLeaderPosition(group: Group): Promise<Point3D | null>;
}

export interface GameEventDispatcher {
    addGroupHandler<EventType extends EngineGroupEvent>(group: Group, eventType: string, callback: (event: EventType) => void): void;
}

export interface Weapon {
    base: string | null;
    sight: string | null;
    ammo: { type: string; quantity: number; }
    description: string | null;
}

export interface Loadout {
    weapons: { primary: Weapon, secondary: Weapon }
}

export interface Waypoint {
    readonly id: string;
    position: Point; // PositionAGL
}

export interface Vehicle {
    readonly id: string;
    name: string;
}

export class Unit {
    public readonly id: string;
    private name: string;
    public loadout: Loadout;
    public readonly traits: string[];

    constructor(id: string, name: string, loadout: Loadout, traits: string[] = []) {
        this.id = id;
        this.name = name;
        this.loadout = loadout;
        this.traits = traits;
    }

    public getName(): string {
        return this.name;
    }

    public setName(name: string): void {
        this.name = name;
    }
}

interface WaypointNode {
    readonly id: string;
    next: WaypointNode | null;
    prev: WaypointNode | null;
}

class WaypointList {
    private head: WaypointNode | null = null;

    public getHead(): WaypointNode | null {
        return this.head;
    }

    public insertInBegin(waypoint: Waypoint): WaypointNode {
        const node: WaypointNode = { id: waypoint.id, next: null, prev: null };
        if (!this.head) {
            this.head = node;
        } else {
            this.head.prev = node;
            node.next = this.head;
            this.head = node;
        }
        return node;
    }

    public insertInEnd(waypoint: Waypoint): WaypointNode {
        const node: WaypointNode = { id: waypoint.id, next: null, prev: null };
        if (!this.head) {
            this.head = node;
        } else {
            let lastNode: WaypointNode = this.head;
            while (lastNode.next != null) {
                lastNode = lastNode.next;
            }

            lastNode.next = node;
            node.prev = lastNode;
        }
        return node;
    }

    public deleteNode(node: WaypointNode): void {
        if (!node.prev) {
            this.head = node.next;
        } else {
            const prevNode = node.prev;
            prevNode.next = node.next;
        }
    }

    public deleteHead(): void {
        if (this.head) {
            this.deleteNode(this.head);
        }
    }

    public deleteById(id: string): boolean {
        if (this.head) {
            let node: WaypointNode = this.head;
            while (node.id != id) {
                if (node.next) {
                    node = node.next;
                } else {
                    return false;
                }
            }
            this.deleteNode(node);
            return true;
        } else {
            return false;
        }
    }
}

export interface Stance {
    behaviour: string;
}

// removed ReactionCallback
export class Task {
    public readonly type: string;
    public readonly id: string;
    public readonly name: string;
    private signal: Signal | null;
    public async execute(group: Group, executor: GameExecutor): Promise<void> { }

    constructor(id: string, type: string, name: string) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.signal = null;
    }
    public setCompletionSignal(signal: Signal) {
        this.signal = signal;
    }

    public getCompletionSignal(): Signal | null {
        return this.signal;
    }

    public static create(name: string) {
        return new Task(uuidv4(), "TASK", name);
    }
}

export class Push extends Task {
    private waypoints: Waypoint[];
    private stanceChangeTo: Stance | null;

    constructor(id: string, name: string, waypoints: Waypoint[]) {
        super(id, "PUSH", name,);
        this.waypoints = waypoints;
        this.stanceChangeTo = null;
    }

    // @TODO: prevent potential race condition: https://gemini.google.com/share/3ed31b0048b2
    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        console.log(`[PUSH] ${group.getName()}: ${this.name}`);
        for (const wp of this.waypoints) {
            executor.addWaypoint(group, wp);
        }

        const finalWaypointId = this.waypoints[this.waypoints.length - 1].id;

        executor.setCombatMode(group, "YELLOW");
        if (this.stanceChangeTo) {
            executor.setCombatBehaviour(group, this.stanceChangeTo.behaviour);
        }

        // Return a Promise that resolves when the domain event fires
        return new Promise((resolve) => {
            const completionListener = (event: EngineGroupEvent) => {
                if (event.type === "WAYPOINT_COMPLETE") {
                    const wpEvent = event as WaypointCompleteEvent;

                    // TODO: Add a timeout or fallback in case Arma AI breaks
                    if (wpEvent.waypointId === finalWaypointId) {
                        group.unsubscribe(completionListener); // Cleanup!
                        resolve(); // This finally unblocks the task!
                    }
                }
            };

            group.subscribe(completionListener);
        });
    }

    public getFinalWaypointPosition(): Point {
        return this.waypoints[this.waypoints.length - 1].position;
    }

    // from the first to the last
    public getWaypointPositions(): Point[] {
        return this.waypoints.map(w => w.position);
    }

    public changeStanceTo(stance: Stance) {
        this.stanceChangeTo = stance;
    }

    public getStanceChangeTo(): Stance | null {
        return this.stanceChangeTo;
    }

    public static fromWaypoints(waypoints: Waypoint[], name: string) {
        return new Push(uuidv4(), name, waypoints);
    }
}

export class Assault extends Task {
    private waypoints: Waypoint[];
    private stanceChangeTo: Stance | null;

    constructor(id: string, name: string, waypoints: Waypoint[]) {
        super(id, "ASSAULT", name);
        this.waypoints = waypoints;
        this.stanceChangeTo = null;
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        console.log(`[ASSAULT] ${group.getName()}: ${this.name}`);
        for (const wp of this.waypoints) {
            executor.addWaypoint(group, wp);
        }

        executor.setCombatMode(group, "RED");
        if (this.stanceChangeTo) {
            executor.setCombatBehaviour(group, this.stanceChangeTo.behaviour);
        }

        const finalWaypointId = this.waypoints[this.waypoints.length - 1].id;

        // Return a Promise that resolves when the domain event fires
        return new Promise((resolve) => {
            const completionListener = (event: EngineGroupEvent) => {
                if (event.type === "WAYPOINT_COMPLETE") {
                    const wpEvent = event as WaypointCompleteEvent;

                    // TODO: Add a timeout or fallback in case Arma AI breaks
                    if (wpEvent.waypointId === finalWaypointId) {
                        group.unsubscribe(completionListener); // Cleanup!
                        resolve(); // This finally unblocks the task!
                    }
                }
            };

            group.subscribe(completionListener);
        });
    }

    public getFinalWaypointPosition(): Point {
        return this.waypoints[this.waypoints.length - 1].position;
    }

    // from the first to the last
    public getWaypointPositions(): Point[] {
        return this.waypoints.map(w => w.position);
    }

    public changeStanceTo(stance: Stance) {
        this.stanceChangeTo = stance;
    }

    public getStanceChangeTo(): Stance | null {
        return this.stanceChangeTo;
    }

    public static fromWaypoints(waypoints: Waypoint[], name: string) {
        return new Assault(uuidv4(), name, waypoints);
    }
}


export class Retreat extends Task {
    private waypoints: Waypoint[];

    constructor(id: string, name: string, waypoints: Waypoint[]) {
        super(id, "RETREAT", name,);
        this.waypoints = waypoints;
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        console.log(`[RETREAT] ${group.getName()}: ${this.name}`);
        for (const wp of this.waypoints) {
            executor.addWaypoint(group, wp);
        }

        executor.setCombatMode(group, "GREEN");

        const finalWaypointId = this.waypoints[this.waypoints.length - 1].id;

        // Return a Promise that resolves when the domain event fires
        return new Promise((resolve) => {
            const completionListener = (event: EngineGroupEvent) => {
                if (event.type === "WAYPOINT_COMPLETE") {
                    const wpEvent = event as WaypointCompleteEvent;

                    // TODO: Add a timeout or fallback in case Arma AI breaks
                    if (wpEvent.waypointId === finalWaypointId) {
                        group.unsubscribe(completionListener); // Cleanup!
                        resolve(); // This finally unblocks the task!
                    }
                }
            };

            group.subscribe(completionListener);
        });
    }

    public getFinalWaypointPosition(): Point {
        return this.waypoints[this.waypoints.length - 1].position;
    }

    // from the first to the last
    public getWaypointPositions(): Point[] {
        return this.waypoints.map(w => w.position);
    }

    public static fromWaypoints(waypoints: Waypoint[], name: string) {
        return new Retreat(uuidv4(), name, waypoints);
    }
}

export class Report extends Task {
    public readonly message: string;
    constructor(id: string, name: string, message: string) {
        super(id, "REPORT", name);
        this.message = message;
    }

    public static fromMessage(message: string, name: string) {
        return new Report(uuidv4(), name, message)
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        console.log(`[REPORT] ${group.getName()}: ${this.message}`);
        const event: ReportGroupEvent = { groupId: group.id, message: this.message, type: "REPORT" };
        group.emitDomainEvent(event);
    }
}

export class SequenceTask extends Task {
    private subTasks: Task[];

    constructor(id: string, name: string, subTasks: Task[]) {
        super(id, "SEQUENCE", name);
        this.subTasks = subTasks;
    }

    public static fromTasks(tasks: Task[], name: string) {
        return new SequenceTask(uuidv4(), name, tasks);
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        if (this.subTasks.length === 0) return;

        for (const task of this.subTasks) {
            await task.execute(group, executor);

            const signal = task.getCompletionSignal();
            if (signal) {
                group.emitSignal(signal);
            }
        }
    }

    public getTasks(): Task[] {
        return this.subTasks;
    }
}

export class WaitTask extends Task {
    public readonly signalToWaitFor: Signal;
    private stanceChangeTo: Stance | null;

    constructor(id: string, name: string, signal: Signal) {
        super(id, "WAIT", name);
        this.signalToWaitFor = signal;
        this.stanceChangeTo = null;
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        executor.setCombatMode(group, "GREEN");
        if (this.stanceChangeTo) {
            executor.setCombatBehaviour(group, this.stanceChangeTo.behaviour);
        } else {
            executor.setCombatBehaviour(group, "AWARE");
        }

        console.log(`[WAIT] ${group.getName()}: waiting now`);
        return new Promise((resolve) => {
            const completionListener = (event: EngineGroupEvent) => {
                if (event.type === "SIGNAL") {
                    const signalEvent = event as SignalEvent;

                    if (signalEvent.signal.id === this.signalToWaitFor.id) {
                        group.unsubscribe(completionListener);
                        resolve();
                    }
                }
            };

            group.subscribe(completionListener);
        });
    }

    public changeStanceTo(stance: Stance) {
        this.stanceChangeTo = stance;
    }

    public getStanceChangeTo(): Stance | null {
        return this.stanceChangeTo;
    }

    public static fromSignal(signal: Signal, name: string | null = null) {
        if (!name) {
            name = `Waiting for '${signal.name}'`;
        }
        return new WaitTask(uuidv4(), name, signal);
    }
}

export type GroupEventListener = (event: GroupEvent) => void;

export type SignalListener = (signal: Signal) => void;

export class Group {
    public readonly id: string;
    private name: string;
    private units: Unit[];
    private unitsAlive: Record<string, boolean>;
    private unitById: Record<string, Unit>;
    private vehicles: Vehicle[];
    private waypointById: Record<string, Waypoint>;
    private waypointList: WaypointList;
    public taskQueue: Task[];
    private listeners: GroupEventListener[];
    private signalListeners: SignalListener[];
    private activeTask: Task | null;
    private executor: GameExecutor;
    private position: Point3D | null;

    constructor(id: string, name: string, executor: GameExecutor) {
        this.id = id;
        this.name = name;
        this.units = [];
        this.unitsAlive = {};
        this.unitById = {};
        this.vehicles = [];
        this.waypointById = {};
        this.waypointList = new WaypointList();
        this.taskQueue = [];
        this.activeTask = null;
        this.executor = executor;
        this.listeners = [];
        this.signalListeners = [];
        this.position = null;
    }

    public getCurrentTask(): Task | null {
        return this.activeTask;
    }

    public getCasualties(): number {
        const aliveUnitCount = this.units.filter((u) => this.unitsAlive[u.id] == true).length
        const unitCount = this.units.length;

        return unitCount - aliveUnitCount;
    }

    // casualteis / total unit count
    public getCasualtyRatio(): number {
        return this.getCasualties() / this.getTotalUnitCount();
    }

    // including dead
    public getTotalUnitCount(): number {
        return this.units.length;
    }

    public getAliveUnitCount(): number {
        return this.units.filter((u) => this.unitsAlive[u.id] == true).length;
    }

    public subscribe(listener: GroupEventListener) {
        this.listeners.push(listener);
    }

    public unsubscribe(listener: GroupEventListener) {
        const index = this.listeners.findIndex(l => l == listener);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    // using separate listener for outbound signals so there is no chance for an infinite loop of a signal to form (it will be difficult to debug)
    public subscribeToSignals(listener: SignalListener) {
        this.signalListeners.push(listener);
    }

    public async receiveSignal(signal: Signal) {
        this.emitDomainEvent({
            type: "SIGNAL",
            groupId: this.id,
            signal: signal
        } as SignalEvent);
    }

    public emitDomainEvent(event: GroupEvent) {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    public getName(): string {
        return this.name;
    }

    public getUnits(): Unit[] {
        return this.units;
    }

    public getVehicles(): Vehicle[] {
        return this.vehicles;
    }

    public getCurrentWaypoint(): Waypoint | null {
        const head = this.waypointList.getHead();
        if (head) {
            return this.waypointById[head.id]
        } else {
            return null;
        }
    }

    public addWaypointInEnd(waypoint: Waypoint) {
        this.waypointList.insertInEnd(waypoint);
    }

    public addTaskToQueue(task: Task) {
        this.taskQueue.push(task);
        if (!this.activeTask) {
            this.executeNext();
        }
    }

    public getPosition(): Point3D {
        if (!this.position) {
            throw Error(`Position of the group ${this.name} wasn't retrieved yet`);
        }
        return this.position;
    }

    public async executeImmediately(task: Task) {
        this.activeTask = task;
        await task.execute(this, this.executor);

        const signal = task.getCompletionSignal();
        if (signal) {
            this.emitSignal(signal);
        }

        this.activeTask = null;
    }

    public clearTasks() {
        this.taskQueue = [];
        this.activeTask = null;
        //TODO: Logic to stop current group movement in Arma (e.g. doStop)
    }

    public addUnit(unit: Unit) {
        this.units.push(unit);
        this.unitById[unit.id] = unit;
        this.unitsAlive[unit.id] = true;
    }

    public addVehicle(vehicle: Vehicle) {
        this.vehicles.push(vehicle);
    }

    public setupEventHandlers(gameEventDispatcher: GameEventDispatcher) {
        gameEventDispatcher.addGroupHandler<WaypointCompleteEvent>(this, "WAYPOINT_COMPLETE", (event: WaypointCompleteEvent) => {
            this.waypointList.deleteById(event.waypointId);
            this.emitDomainEvent(event);
        });

        gameEventDispatcher.addGroupHandler<UnitKilledEvent>(this, "UNIT_KILLED", (event: UnitKilledEvent) => {
            this.unitsAlive[event.unitId] = false;
            this.emitDomainEvent(event);
        });

        gameEventDispatcher.addGroupHandler<EnemyDetectedEvent>(this, "ENEMY_DETECTED", (event: EnemyDetectedEvent) => {
            this.emitDomainEvent(event);
        });

        gameEventDispatcher.addGroupHandler<CombatModeChangedEvent>(this, "COMBAT_MODE_CHANGED", (event: CombatModeChangedEvent) => {
            this.emitDomainEvent(event);
        });
    }


    public emitSignal(signal: Signal) {
        for (const listener of this.signalListeners) {
            listener(signal);
        }
    }

    public async executeNext() {
        if (this.taskQueue.length === 0) {
            this.activeTask = null;
            return;
        }

        this.activeTask = this.taskQueue.shift() || null;
        if (this.activeTask) {
            // This will now naturally wait for the task to finish itself
            await this.activeTask.execute(this, this.executor);
            const signal = this.activeTask.getCompletionSignal()
            if (signal) {
                this.emitSignal(signal);
            }
            this.executeNext();
        }
    }

    public async updateSituationalData() {
        const newPos = await this.executor.getGroupLeaderPosition(this);
        if (!newPos) {
            throw Error(`Error when updating situational data for group ${this.name}: retrieved position is null`);
        }
        this.position = newPos;
    }
}

export class Army {
    private readonly side: string;
    private groups: Group[];
    private groupById: Record<string, Group>;

    constructor(side: string) {
        this.side = side;
        this.groups = [];
        this.groupById = {};
    }

    public addGroup(group: Group) {
        this.groups.push(group);
        this.groupById[group.id] = group;
        group.subscribeToSignals((signal) => {
            this.propagateSignal(signal);
        });
    }

    public getGroupById(id: string): Group | undefined {
        return this.groupById[id];
    }

    public getGroups(): Group[] {
        return this.groups.slice(0);
    }

    private propagateSignal(signal: Signal) {
        this.groups.forEach(g => g.receiveSignal(signal));
    }
}

export class ArmyComposer {
    private readonly gameExecutor: GameExecutor;
    private readonly gameEventDispatcher: GameEventDispatcher;

    constructor(gameExecutor: GameExecutor, gameEventDispatcher: GameEventDispatcher) {
        this.gameExecutor = gameExecutor;
        this.gameEventDispatcher = gameEventDispatcher;
    }

    public async composeArmyOfSide(side: string): Promise<Army> {
        const army = new Army(side);
        console.log("getting groups");
        const groups = await this.gameExecutor.getGroups(side);
        console.log("got gruops ");

        for (const group of groups) {
            const units = await this.gameExecutor.getGroupUnits(group);
            units.forEach(u => group.addUnit(u));
            const waypoints = await this.gameExecutor.getWaypoints(group);
            waypoints.forEach(wp => group.addWaypointInEnd(wp));
            const vehicles = await this.gameExecutor.getGroupAssignedVehicles(group);
            vehicles.forEach(v => group.addVehicle(v));

            this.gameExecutor.addGroupEventHandlers(group);
            group.setupEventHandlers(this.gameEventDispatcher);

            army.addGroup(group);
        }

        return army;
    }
}