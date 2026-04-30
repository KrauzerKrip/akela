import { Army, Group, Unit, Vehicle, Waypoint, GameExecutor, GameEventDispatcher, Loadout } from "../army";
import { Point3D } from "../geography";

export function serializeArmy(army: Army): any {
    return {
        side: (army as any).side,
        groups: army.getGroups().map(g => ({
            id: g.id,
            name: g.getName(),
            position: (g as any).position,
            units: g.getUnits().map(u => ({
                id: u.id,
                name: u.getName(),
                loadout: u.loadout,
                traits: u.traits
            })),
            vehicles: g.getVehicles().map(v => ({
                id: v.id,
                name: v.name
            })),
            waypoints: (() => {
                const wps: Waypoint[] = [];
                let curr = (g as any).waypointList?.getHead();
                while (curr) {
                    if ((g as any).waypointById && (g as any).waypointById[curr.id]) {
                        wps.push((g as any).waypointById[curr.id]);
                    }
                    curr = curr.next;
                }
                return wps;
            })()
        }))
    };
}

export class MockGameExecutor implements GameExecutor {
    async getGroupBuilders(side: string) { return []; }
    async getGroupUnits(group: Group) { return []; }
    async getUnitLoadout(unit: Unit): Promise<Loadout> { return unit.loadout; }
    async addWaypoint(group: Group, waypoint: Waypoint) { }
    async getWaypoints(group: Group) { return []; }
    async getGroupAssignedVehicles(group: Group) { return []; }
    async setCombatMode(group: Group, mode: string) { }
    async setCombatBehaviour(group: Group, behaviour: string) { }
    async setGroupId(group: Group, name: string) { }
    async setFormation(group: Group, formation: string) { }
    async addGroupEventHandlers(group: Group) { }
    async getGroupLeaderPosition(group: Group): Promise<Point3D | null> { return null; }
    async commandLoad(group: Group, vehicle: Vehicle) { }
    async commandUnload(group: Group) { }
    async stopGroup(group: Group) { }
    async clearGroupWaypoints(group: Group) { }
}

export class MockGameEventDispatcher implements GameEventDispatcher {
    addGroupHandler(group: Group, eventType: string, callback: any) { }
}

export function deserializeArmy(data: any): Army {
    const executor = new MockGameExecutor();
    const dispatcher = new MockGameEventDispatcher();
    const session = { getId: () => "test-session" } as any;

    const army = new Army(data.side);

    for (const gData of data.groups) {
        const group = new Group(gData.id, gData.name, session, executor);
        if (gData.position) {
            (group as any).position = gData.position;
        }

        for (const uData of gData.units) {
            const unit = new Unit(uData.id, uData.name, uData.loadout, uData.traits);
            group.addUnit(unit);
        }

        for (const vData of gData.vehicles) {
            group.addVehicle({ id: vData.id, name: vData.name });
        }

        for (const wpData of (gData.waypoints || [])) {
            if (wpData) {
                group.addWaypointInEnd(wpData);
            }
        }

        group.setupEventHandlers(dispatcher);
        army.addGroup(group);
    }

    return army;
}
