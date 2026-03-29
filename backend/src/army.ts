import { Point } from "./geography";
import { v4 as uuidv4 } from 'uuid';

export interface GameExecutor {
    addWaypoint(group: Group, waypoint: Waypoint): Promise<void>;
    getGroupAssignedVehicles(group: Group): Promise<string[]>;
    setCombatMode(group: Group, mode: string): Promise<void>;
    setCombatBehaviour(group: Group, behaviour: string): Promise<void>;
    setGroupId(group: Group, name: string): Promise<void>;
    setFormation(group: Group, formation: string): Promise<void>;
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
    readonly completionCallback: () => void;
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
}

export class Task {
    public readonly id: string;
    protected readonly group: Group;
    public async execute(executor: GameExecutor): Promise<void> { }

    constructor(id: string, group: Group) {
        this.id = id;
        this.group = group;
    }

    public static createForGroup(group: Group) {
        return new Task(uuidv4(), group);
    }
}

export class Push extends Task {
    private waypoints: Waypoint[];

    constructor(id: string, group: Group, waypoints: Waypoint[]) {
        super(id, group);
        this.waypoints = waypoints;
    }

    public async execute(executor: GameExecutor): Promise<void> {
        for (const wp of this.waypoints) {
            executor.addWaypoint(this.group, wp);
        }
    }

    public static fromWaypoints(group: Group, waypoints: Waypoint[]) {
        return new Push(uuidv4(), group, waypoints);
    }
}

export class Assault extends Task {
    private waypoints: Waypoint[];

    constructor(id: string, group: Group, waypoints: Waypoint[]) {
        super(id, group);
        this.waypoints = waypoints;
    }

    public async execute(executor: GameExecutor): Promise<void> {
        for (const wp of this.waypoints) {
            executor.addWaypoint(this.group, wp);
            executor.setCombatMode(this.group, "RED");
        }
    }

    public static fromWaypoints(group: Group, waypoints: Waypoint[]) {
        return new Assault(uuidv4(), group, waypoints);
    }
}

export const taskQueue: Task[] = [];

export function addTaskToQueue(task: Task) {
    taskQueue.push(task);
}

export function executeImmediately(task: Task, executor: GameExecutor) {
    task.execute(executor);
}

export class Group {
    public readonly id: string;
    private name: string;
    private units: Unit[];
    private unitById: Record<string, Unit>;
    private waypointById: Record<string, Waypoint>;
    private waypointList: WaypointList;

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.units = [];
        this.unitById = {};
        this.waypointById = {};
        this.waypointList = new WaypointList();
    }

    public getCurrentWaypoint(): Waypoint | null {
        const head = this.waypointList.getHead();
        if (head) {
            return this.waypointById[head.id]
        } else {
            return null;
        }
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
}
