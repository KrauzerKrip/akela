import { Group, Task, Unit, Waypoint, GameEventDispatcher, Event, EngineGroupEvent, UnitKilledEvent, EnemyDetectedEvent, WaypointCompleteEvent, CombatModeChangedEvent, Loadout, Weapon, Vehicle, EmbarkingCompleteEvent } from "./army";
import { GameExecutor } from "./army";
import { Point, Point3D } from "./geography";
import { sendArmaRequest } from "./server";
import { v4 as uuidv4 } from 'uuid';

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
    private groupEventHandlers: Record<string, Record<string, ((event: any) => void)[]>>;

    constructor() {
        this.armaWaypoints = {};
        this.armaObjects = {};
        this.armaGroups = {};
        this.waypointIds = {};
        this.objectIds = {};
        this.groupIds = {};
        this.groupEventHandlers = {};
    }

    public addGroupHandler<EventType extends EngineGroupEvent>(group: Group, eventType: string, callback: (event: EventType) => void): void {
        if (!this.groupEventHandlers[group.id]) {
            this.groupEventHandlers[group.id] = {};
        }
        if (!this.groupEventHandlers[group.id][eventType]) {
            this.groupEventHandlers[group.id][eventType] = [];
        }
        this.groupEventHandlers[group.id][eventType].push(callback as (event: any) => void);
    }

    public fireGroupEvent(event: EngineGroupEvent): void {
        const groupId = event.groupId;
        if (!groupId) return;

        const groupHandlers = this.groupEventHandlers[groupId];
        if (groupHandlers) {
            const handlers = groupHandlers[event.type];
            if (handlers) {
                for (const handler of handlers) {
                    handler(event);
                }
            }
        }
    }

    public processRawEvent(eventName: string, params: any): void {
        const parsedEvent = this.parseArmaGroupEvent(eventName, params);
        console.log(parsedEvent);
        if (parsedEvent) {
            this.fireGroupEvent(parsedEvent);
        }
    }

    private parseArmaGroupEvent(eventName: string, params: any): EngineGroupEvent | null {
        if (!Array.isArray(params) || params.length === 0) return null;

        const groupNetId = params[0];
        const groupId = this.getGroupId(groupNetId);
        if (!groupId) return null;

        switch (eventName) {
            case "CombatModeChanged": {
                return {
                    type: "COMBAT_MODE_CHANGED",
                    groupId,
                    newMode: params[1]
                } as CombatModeChangedEvent;
            }
            case "UnitKilled": {
                const unitId = this.getUnitId(params[1]);

                return {
                    type: "UNIT_KILLED",
                    groupId,
                    unitId: unitId ?? "unknown",
                } as UnitKilledEvent;
            }
            case "WaypointComplete": {
                const index = params[1];
                const wpId = this.waypointIds[`${groupNetId}-${index}` as CompositeWaypointKey];
                if (!wpId) return null;

                return {
                    type: "WAYPOINT_COMPLETE",
                    groupId,
                    waypointId: wpId
                } as WaypointCompleteEvent;
            }
            case "EnemyDetected": {
                const targetId = params[1];
                const positionAgls = params[2];
                const position: Point3D = { x: positionAgls[0], y: positionAgls[1], z: positionAgls[2] };
                const kind = params[3];
                return {
                    type: "ENEMY_DETECTED",
                    groupId,
                    newTargetId: targetId,
                    position: position,
                    kind: kind
                } as EnemyDetectedEvent;
            }
            case "LoadComplete": {
                const vehicleId = this.getVehicleId(params[1]);
                const status = params[2];
                return {
                    type: "EMBARKING_COMPLETE",
                    vehicleId: vehicleId,
                    status: status,
                } as EmbarkingCompleteEvent;
            }
        }

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

    public registerVehicle(id: string, netId: NetId): void {
        this.armaObjects[id] = netId;
        this.objectIds[netId] = id;
    }

    public unregisterUnit(id: string): void {
        const netId = this.armaObjects[id];
        if (netId !== undefined) {
            delete this.armaObjects[id];
            delete this.objectIds[netId];
        }
    }

    public unregisterVehicle(id: string): void {
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

    public getArmaVehicleNetId(id: string): NetId | undefined {
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

    public getVehicleId(netId: NetId): string | undefined {
        return this.objectIds[netId];
    }

    public getGroupId(netId: NetId): string | undefined {
        return this.groupIds[netId];
    }

    public getWaypointId(waypoint: ArmaWaypoint): string | undefined {
        const key: CompositeWaypointKey = `${waypoint.groupNetId}-${waypoint.index}`;
        return this.waypointIds[key];
    }

    public async addGroupEventHandlers(group: Group): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["addEventHandlers", armaGroupNetId]]);

            if (result && result[0] && Array.isArray(result[0][2])) {
                const data = result[0][2];
                if (data[0] == "error") {
                    console.log(`group ${group.getName()} event handler error: ${data[1]}`);
                }
            }
        }
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
        }
    }

    public async getWaypoints(group: Group): Promise<Waypoint[]> {
        const armaWaypoints = await this.getArmaWaypoints(group);
        const maybePositions = await Promise.all(armaWaypoints.map((wp) => this.getArmaWaypointPosition(wp)));
        const positions: Point3D[] = [];
        const errors: ArmaWaypoint[] = [];
        for (let i = 0; i < maybePositions.length; i++) {
            const maybePosition = maybePositions[i];
            if (maybePosition) {
                positions.push(maybePosition);
            } else {
                errors.push(armaWaypoints[i]);
            }
        }
        if (errors.length > 0) {
            const errorWpsMsg = errors.map(e => `group: ${group.getName()}, index: ${e.index}`).join("\n");
            throw Error("Couldn't get position for waypoints: " + errorWpsMsg);
        }
        const zip = (a: ArmaWaypoint[], b: Point3D[]) => a.map((k, i) => [k, b[i]]);
        return zip(armaWaypoints, positions).map(armaWpAndPos => {
            const armaWp = armaWpAndPos[0] as ArmaWaypoint;
            const pos = armaWpAndPos[1] as Point3D;
            const key: CompositeWaypointKey = `${armaWp.groupNetId}-${armaWp.index}`;
            let id = this.waypointIds[key];
            if (!id) {
                id = uuidv4();
                this.registerWaypoint(id, armaWp);
            }
            return {
                id,
                position: { x: pos.x, y: pos.y }
            } as Waypoint;
        });
    }

    public async getGroups(side: string): Promise<Group[]> {
        const data = await this.getArmaGroups(side);
        return data.map((groupData: string[]) => {
            const netId = groupData[0];
            const name = groupData[1];

            let id = this.getGroupId(netId);
            if (!id) {
                id = uuidv4();
                this.registerGroup(id, netId);
            }
            return new Group(id, name, this);
        });
    }

    public async getGroupUnits(group: Group): Promise<Unit[]> {
        const data = await this.getArmaGroupUnits(group);
        const units: Unit[] = [];
        for (const unitData of data) {
            const netId = unitData[0];
            const name = unitData[1];

            let id = this.getUnitId(netId);
            if (!id) {
                id = uuidv4();
                this.registerUnit(id, netId);
            }

            const tempUnit = new Unit(id, name, { weapons: { primary: { base: null, sight: null, ammo: { type: "", quantity: 0 }, description: null }, secondary: { base: null, sight: null, ammo: { type: "", quantity: 0 }, description: null } } });
            // const loadout = {
            //     weapons: {
            //         primary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
            //         secondary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
            //     }
            // };
            const loadout = await this.getUnitLoadout(tempUnit);
            units.push(new Unit(id, name, loadout, []));
        }
        return units;
    }

    public async getUnitLoadout(unit: Unit): Promise<Loadout> {
        const data = await this.getArmaUnitLoadout(unit);

        const parseWeapon = (weaponData: any[]): Weapon => {
            if (!weaponData || weaponData.length === 0) {
                return { base: null, sight: null, ammo: { type: "", quantity: 0 }, description: null };
            }
            return {
                base: weaponData[0] || null,
                sight: weaponData[3] || null,
                ammo: {
                    type: weaponData[4]?.[0] || "",
                    quantity: weaponData[4]?.[1] || 0
                },
                description: null
            };
        };

        return {
            weapons: {
                primary: parseWeapon(data[0] || []),
                secondary: parseWeapon(data[1] || [])
            }
        };
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

    public async commandLoad(group: Group, vehicle: Vehicle): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        const armaVehicleGroupId = this.getArmaVehicleNetId(vehicle.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["commandLoad", [armaGroupNetId, armaVehicleGroupId]]]);
            const data = result[0]?.[2];
            if (Array.isArray(data) && data.length > 0 && data[0]?.[0] === "error") {
                console.error(data[0]?.[1]);
            }
        }
    }


    public async commandUnload(group: Group): Promise<void> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["commandUnload", armaGroupNetId]]);
            const data = result[0]?.[2];
            if (Array.isArray(data) && data.length > 0 && data[0]?.[0] === "error") {
                console.error(data[0]?.[1]);
            }
        }
    }

    public async getGroupAssignedVehicles(group: Group): Promise<Vehicle[]> {
        const data = await this.getGroupAssignedArmaVehicles(group);
        const vehicles: Vehicle[] = [];
        for (const unitData of data) {
            const netId = unitData[0];
            const name = unitData[1];

            let id = this.getVehicleId(netId);
            if (!id) {
                id = uuidv4();
                this.registerVehicle(id, netId);
            }

            const vehicle: Vehicle = { id: id, name: name };
            vehicles.push(vehicle);
        }
        return vehicles;
    }

    public async getGroupLeaderPosition(group: Group): Promise<Point3D | null> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["getGroupLeaderPosition", armaGroupNetId]]);
            const data = result[0]?.[2];
            if (Array.isArray(data) && data.length > 0 && data[0]?.[0] === "error") {
                return null;
            }
            return { x: data[0], y: data[1], z: data[2] };
        }
        return null;
    }

    public async executeTask(task: Task) {
        // double-dispatch!!!
        task.execute(this as any, this);
    }

    public async getArmaWaypoints(group: Group): Promise<ArmaWaypoint[]> {
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

    public async getArmaWaypointPosition(waypoint: ArmaWaypoint): Promise<Point3D | null> {
        const result = await sendArmaRequest([["getWaypointPosition", [waypoint.groupNetId, waypoint.index]]]);
        if (result && result[0] && Array.isArray(result[0][2])) {
            const data = result[0][2];
            if (data.length > 0 && data[0] === "error") {
                return null;
            }
            return { x: data[0], y: data[1], z: data[2] };
        }
        return null;

    }

    public async getArmaGroups(side: string): Promise<any[]> {
        const result = await sendArmaRequest([["groups", side]]);
        if (result && result[0] && Array.isArray(result[0][2])) {
            return result[0][2];
        }
        return [];
    }

    public async getArmaGroupUnits(group: Group): Promise<any[]> {
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

    public async getArmaUnitLoadout(unit: Unit): Promise<any[]> {
        const armaUnitNetId = this.getArmaUnitNetId(unit.id);
        if (armaUnitNetId !== undefined) {
            const result = await sendArmaRequest([["getUnitLoadout", armaUnitNetId]]);
            return result[0]?.[2] ?? [];
        }
        return [];
    }

    public async getGroupAssignedArmaVehicles(group: Group): Promise<string[]> {
        const armaGroupNetId = this.getArmaGroupNetId(group.id);
        if (armaGroupNetId !== undefined) {
            const result = await sendArmaRequest([["getGroupAssignedVehicle", armaGroupNetId]]);
            return result[0]?.[2] ?? [];
        }
        return [];
    }
}