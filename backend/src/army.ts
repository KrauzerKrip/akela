import { Point } from "./geography";
import { v4 as uuidv4 } from 'uuid';

export interface Event {
    type: string;
}

export interface GroupEvent extends Event {
    groupId: string;
}

export interface UnitKilledEvent extends GroupEvent {
    type: "UNIT_KILLED";
    unitId: string;
    // fields "killer" and "instigator" omitted because the current domain model doesn't require them
}

export interface EnemyDetectedEvent extends GroupEvent {
    type: "ENEMY_DETECTED";
    newTargetId?: string;
}

export interface WaypointCompleteEvent extends GroupEvent {
    type: "WAYPOINT_COMPLETE";
    waypointId: string;
}

export interface CombatModeChangedEvent extends GroupEvent {
    type: "COMBAT_MODE_CHANGED";
    newMode: string;
}

export interface TaskCompleteEvent extends GroupEvent {
    type: "TASK_COMPLETE";
    taskId: string;
}

export interface GameExecutor {
    addWaypoint(group: Group, waypoint: Waypoint): Promise<void>;
    getGroupAssignedVehicles(group: Group): Promise<string[]>;
    setCombatMode(group: Group, mode: string): Promise<void>;
    setCombatBehaviour(group: Group, behaviour: string): Promise<void>;
    setGroupId(group: Group, name: string): Promise<void>;
    setFormation(group: Group, formation: string): Promise<void>;
}

export interface GameEventDispatcher {
    addGroupHandler<EventType extends GroupEvent>(group: Group, eventType: string, callback: (event: EventType) => void): void;
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



// removed ReactionCallback
export class Task {
    public readonly type: string;
    public readonly id: string;
    public readonly name: string;
    public async execute(group: Group, executor: GameExecutor): Promise<void> { }

    constructor(id: string, type: string, name: string) {
        this.id = id;
        this.name = name;
        this.type = type;
    }


    public static create(name: string) {
        return new Task(uuidv4(), "TASK", name);
    }
}

export class Push extends Task {
    private waypoints: Waypoint[];

    constructor(id: string, name: string, waypoints: Waypoint[]) {
        super(id, "PUSH", name,);
        this.waypoints = waypoints;
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        for (const wp of this.waypoints) {
            executor.addWaypoint(group, wp);
        }
    }

    public static fromWaypoints(waypoints: Waypoint[], name: string) {
        return new Push(uuidv4(), name, waypoints);
    }
}

export class Assault extends Task {
    private waypoints: Waypoint[];

    constructor(id: string, name: string, waypoints: Waypoint[]) {
        super(id, "ASSAULT", name);
        this.waypoints = waypoints;
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        for (const wp of this.waypoints) {
            executor.addWaypoint(group, wp);
            executor.setCombatMode(group, "RED");
        }
    }

    public static fromWaypoints(waypoints: Waypoint[], name: string) {
        return new Assault(uuidv4(), name, waypoints);
    }
}

export class Retreat extends Task {
    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        // Handle retreat logic
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
    }
}

export class SequenceTask extends Task {
    private subTasks: Task[];
    private currentIndex: number = 0;

    constructor(id: string, name: string, subTasks: Task[]) {
        super(id, "SEQUENCE", name);
        this.subTasks = subTasks;
    }

    public static fromTasks(tasks: Task[], name: string) {
        return new SequenceTask(uuidv4(), name, tasks);
    }

    public async execute(group: Group, executor: GameExecutor): Promise<void> {
        if (this.subTasks.length === 0) return;

        // The sequence doesn't finish until all children are done.
        // We inject the subtasks into the front of the group's queue.
        for (let i = this.subTasks.length - 1; i >= 0; i--) {
            group.taskQueue.unshift(this.subTasks[i]);
        }

        await group.executeNext();
    }
}

export type GroupEventListener = (event: GroupEvent) => void;

export class Group {
    public readonly id: string;
    private name: string;
    private units: Unit[];
    private unitsAlive: Record<string, boolean>;
    private unitById: Record<string, Unit>;
    private waypointById: Record<string, Waypoint>;
    private waypointList: WaypointList;
    public taskQueue: Task[];
    private listeners: GroupEventListener[] = [];
    private activeTask: Task | null;
    private executor: GameExecutor;

    constructor(id: string, name: string, executor: GameExecutor) {
        this.id = id;
        this.name = name;
        this.units = [];
        this.unitsAlive = {};
        this.unitById = {};
        this.waypointById = {};
        this.waypointList = new WaypointList();
        this.taskQueue = [];
        this.activeTask = null;
        this.executor = executor;
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

    public emitDomainEvent(event: GroupEvent) {
        for (const listener of this.listeners) {
            listener(event);
        }
    }

    public getName(): string {
        return this.name;
    }

    public getCurrentWaypoint(): Waypoint | null {
        const head = this.waypointList.getHead();
        if (head) {
            return this.waypointById[head.id]
        } else {
            return null;
        }
    }

    public addTaskToQueue(task: Task) {
        this.taskQueue.push(task);
        if (!this.activeTask) {
            this.executeNext();
        }
    }

    public async executeNext() {
        this.activeTask = this.taskQueue.shift() || null;
        if (this.activeTask) {
            await this.activeTask.execute(this, this.executor);
        }
    }

    public async executeImmediately(task: Task) {
        await task.execute(this, this.executor);
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
    }

    public getGroupById(id: string): Group | undefined {
        return this.groupById[id];
    }

    public getGroups(): Group[] {
        return this.groups.slice(0);
    }
}
