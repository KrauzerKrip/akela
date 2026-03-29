export type NetId = number;

export interface ArmaWaypoint {
    groupNetId: NetId;
    index: number;
}

type CompositeWaypointKey = `${NetId}-${number}`;

export class ArmaConnector {
    private arma_waypoints: Record<string, ArmaWaypoint>;
    private arma_objects: Record<string, NetId>;
    private arma_groups: Record<string, NetId>;
    private waypoint_ids: Record<CompositeWaypointKey, string>;
    private object_ids: Record<NetId, string>;
    private group_ids: Record<NetId, string>

    constructor() {
        this.arma_waypoints = {};
        this.arma_objects = {};
        this.arma_groups = {};
        this.waypoint_ids = {};
        this.object_ids = {}
        this.group_ids = {};
    }

    public registerUnit(id: string, netId: NetId): void {
        this.arma_objects[id] = netId;
        this.object_ids[netId] = id;
    }

    public registerGroup(id: string, netId: NetId): void {
        this.arma_groups[id] = netId;
        this.group_ids[netId] = id;
    }

    public registerWaypoint(id: string, waypoint: ArmaWaypoint): void {
        this.arma_waypoints[id] = waypoint;
        const key: CompositeWaypointKey = `${waypoint.groupNetId}-${waypoint.index}`;
        this.waypoint_ids[key] = id;
    }

    public getArmaUnitNetId(id: string): NetId | undefined {
        return this.arma_objects[id];
    }

    public getArmaGroupNetId(id: string): NetId | undefined {
        return this.arma_groups[id];
    }

    public getArmaWaypoint(id: string): ArmaWaypoint | undefined {
        return this.arma_waypoints[id];
    }

    public getUnitId(netId: NetId): string | undefined {
        return this.object_ids[netId];
    }

    public getGroupId(netId: NetId): string | undefined {
        return this.group_ids[netId];
    }

    public getWaypointId(waypoint: ArmaWaypoint): string | undefined {
        const key: CompositeWaypointKey = `${waypoint.groupNetId}-${waypoint.index}`;
        return this.waypoint_ids[key];
    }
}