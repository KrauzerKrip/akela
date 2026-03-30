import { Group, Task, Unit, Waypoint, GameEventDispatcher, Event } from "./army";
import { GameExecutor } from "./army";
import { sendArmaRequest } from "./index";

export type NetId = string;

export interface ArmaWaypoint {
    groupNetId: NetId;
    index: number;
}

type CompositeWaypointKey = `${NetId}-${number}`;


export class ArmaConnector implements GameExecutor, GameEventDispatcher {
    private armaWaypoints: Record<string, ArmaWaypoint>;
    private armaObjects: Record<string, NetId>;
    private armaGroups: Record<string, NetId>;
    private waypointIds: Record<CompositeWaypointKey, string>;
    private objectIds: Record<NetId, string>;
    private groupIds: Record<NetId, string>;
    private eventHandlers: Record<string, ((event: any) => void)[]>;

    constructor() {
        this.armaWaypoints = {};
        this.armaObjects = {};
        this.armaGroups = {};
        this.waypointIds = {};
        this.objectIds = {};
        this.groupIds = {};
        this.eventHandlers = {};
    }

    public addHandler<EventType extends Event>(eventType: string, callback: (event: EventType) => void): void {
        if (!this.eventHandlers[eventType]) {
            this.eventHandlers[eventType] = [];
        }
        this.eventHandlers[eventType].push(callback as (event: any) => void);
    }

    public fireEvent(event: Event): void {
        const handlers = this.eventHandlers[event.type];
        if (handlers) {
            for (const handler of handlers) {
                handler(event);
            }
        }
    }

    public processRawEvent(eventName: string, params: any): void {
        const parsedEvent = this.parseArmaEvent(eventName, params);
        if (parsedEvent) {
            this.fireEvent(parsedEvent);
        }
    }

    private parseArmaEvent(eventName: string, params: any): Event | null {
        // @TODO: Implement conversion from raw Arma 3 event to internal Event model
        return null;
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
            const result = await sendArmaRequest([["addWaypoint", [armaGroupNetId, position, 0, -1, waypoint.id]]]);

            if (result && result[0] && Array.isArray(result[0][2])) {
                const data = result[0][2];
                if (data[0] !== "error") {
                    this.registerWaypoint(waypoint.id, {
                        groupNetId: data[0],
                        index: data[1]
                    });
                }
            }
            // @TODO completion callback
        }
    }

    public async getWaypoints(group: Group): Promise<ArmaWaypoint[]> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["waypoints", armaGroupNetId]]);
            if (result && result[0] && Array.isArray(result[0][2])) {
                const data = result[0][2];
                if (data.length > 0 && data[0] === "error") {
                    return [];
                }
                return data.map((wp: any[]) => ({
                    groupNetId: wp[0],
                    index: wp[1]
                }));
            }
        }
        return [];
    }

    public async getGroupAssignedVehicles(group: Group): Promise<string[]> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["getGroupAssignedVehicle", armaGroupNetId]]);
            return result[0]?.[2] ?? [];
        }
        return [];
    }

    public async getGroups(side: string): Promise<any[]> {
        const result = await sendArmaRequest([["groups", side]]);
        if (result && result[0] && Array.isArray(result[0][2])) {
            return result[0][2];
        }
        return [];
    }

    public async getGroupUnits(group: Group): Promise<any[]> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["units", armaGroupNetId]]);
            const data = result[0]?.[2];
            if (Array.isArray(data) && data.length > 0 && data[0]?.[0] === "error") {
                return [];
            }
            return data ?? [];
        }
        return [];
    }


    public async getUnitLoadout(unit: Unit): Promise<any[]> {
        const armaUnitNetId = this.getArmaUnitNetId(unit.id);
        if (armaUnitNetId !== undefined) {
            const result = await sendArmaRequest([["getUnitLoadout", armaUnitNetId]]);
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