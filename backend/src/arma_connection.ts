import { Group, Task, Waypoint } from "./army";
import { GameExecutor } from "./army";
import { sendArmaRequest } from "./index";

export type NetId = number;

export interface ArmaWaypoint {
    groupNetId: NetId;
    index: number;
}

type CompositeWaypointKey = `${NetId}-${number}`;


export class ArmaConnector implements GameExecutor {
    private armaWaypoints: Record<string, ArmaWaypoint>;
    private armaObjects: Record<string, NetId>;
    private armaGroups: Record<string, NetId>;
    private waypointIds: Record<CompositeWaypointKey, string>;
    private objectIds: Record<NetId, string>;
    private groupIds: Record<NetId, string>

    constructor() {
        this.armaWaypoints = {};
        this.armaObjects = {};
        this.armaGroups = {};
        this.waypointIds = {};
        this.objectIds = {}
        this.groupIds = {};
    }

    public registerUnit(id: string, netId: NetId): void {
        this.armaObjects[id] = netId;
        this.objectIds[netId] = id;
    }

    public registerGroup(id: string, netId: NetId): void {
        this.armaGroups[id] = netId;
        this.groupIds[netId] = id;
    }

    public registerWaypoint(id: string, waypoint: ArmaWaypoint): void {
        this.armaWaypoints[id] = waypoint;
        const key: CompositeWaypointKey = `${waypoint.groupNetId}-${waypoint.index}`;
        this.waypointIds[key] = id;
    }

    public unregisterUnit(id: string): void {
        const netId = this.armaObjects[id];
        if (netId !== undefined) {
            delete this.armaObjects[id];
            delete this.objectIds[netId];
        }
    }

    public unregisterGroup(id: string): void {
        const netId = this.armaGroups[id];
        if (netId !== undefined) {
            delete this.armaGroups[id];
            delete this.groupIds[netId];
        }
    }

    public removeWaypoint(id: string): void {
        const waypoint = this.armaWaypoints[id];
        if (waypoint) {
            const key: CompositeWaypointKey = `${waypoint.groupNetId}-${waypoint.index}`;
            delete this.waypointIds[key];
            delete this.armaWaypoints[id];
        }
    }

    public getArmaUnitNetId(id: string): NetId | undefined {
        return this.armaObjects[id];
    }

    public getArmaGroupNetId(id: string): NetId | undefined {
        return this.armaGroups[id];
    }

    public getArmaWaypoint(id: string): ArmaWaypoint | undefined {
        return this.armaWaypoints[id];
    }

    public getUnitId(netId: NetId): string | undefined {
        return this.objectIds[netId];
    }

    public getGroupId(netId: NetId): string | undefined {
        return this.groupIds[netId];
    }

    public getWaypointId(waypoint: ArmaWaypoint): string | undefined {
        const key: CompositeWaypointKey = `${waypoint.groupNetId}-${waypoint.index}`;
        return this.waypointIds[key];
    }

    public async addWaypoint(group: Group, waypoint: Waypoint): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const position = [waypoint.position.x, waypoint.position.y];
            await sendArmaRequest([["addWaypoint", [armaGroupNetId, position]]]);
            // @TODO completion callback
        }
    }

    public async getGroupAssignedVehicles(group: Group): Promise<string[]> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["get_group_assigned_vehicles", armaGroupNetId]]);
            return result[0]?.[2] ?? [];
        }
        return [];
    }

    public async setCombatMode(group: Group, mode: string): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            await sendArmaRequest([["setCombatMode", [armaGroupNetId, mode]]]);
        }
    }

    public async setCombatBehaviour(group: Group, behaviour: string): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            await sendArmaRequest([["setCombatBehaviour", [armaGroupNetId, behaviour]]]);
        }
    }

    public async setGroupId(group: Group, name: string): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            await sendArmaRequest([["setGroupId", [armaGroupNetId, name]]]);
        }
    }

    public async setFormation(group: Group, formation: string): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            await sendArmaRequest([["setFormation", [armaGroupNetId, formation]]]);
        }
    }

    public async executeTask(task: Task) {
        // double-dispatch!!!
        task.execute(this);
    }
}