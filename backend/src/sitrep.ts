import { Group, Loadout, Push, Vehicle } from "./army";
import { GroupCombatMonitor, GroupStatus, TrackedEnemy } from "./combat";
import { Point, Point3D } from "./geography";

export enum GroupSitrepStatus {
    Normal,
    Engaged
}

export interface TaskSitrep {
    name: string;
    type: string;
    behaviour: string;
    destination: Point | null;
}

export interface ContactSitrep {
    kind: string;
    count: number;
    position: Point;
}

type UnitRole = "Rifleman" | "AT" | "AA";

export interface UnitSitrep {
    role: UnitRole;
}

export interface Sitrep {
    groupName: string;
    units: UnitSitrep[];
    vehicles: string[];
    position: Point;
    status: GroupSitrepStatus;
    effectiveness: number;
    task: TaskSitrep | null;
    contacts: ContactSitrep[];
}

const antiTankWeapons: string[] = ["launch_B_Titan_short_F", "launch_B_Titan_short_tna_F", "launch_I_Titan_short_F", "launch_MRAWS_green_F", "launch_MRAWS_green_rail_F", "launch_MRAWS_olive_F", "launch_MRAWS_olive_rail_F", "launch_MRAWS_sand_F", "launch_MRAWS_sand_rail_F", "launch_NLAW_F", "launch_O_Titan_short_F", "launch_O_Titan_short_ghex_F", "launch_Titan_short_F", "launch_O_Vorona_brown_F", "launch_O_Vorona_green_F", "launch_RPG32_camo_F", "launch_RPG32_F", "launch_RPG32_ghex_F", "launch_RPG32_green_F", "launch_RPG7_F"];
const antiAirWeapons: string[] = [
    "launch_B_Titan_F",          // Titan MPRL (Sand)
    "launch_B_Titan_olive_F",    // Titan MPRL (Olive)
    "launch_B_Titan_tna_F",      // Titan MPRL (Tropic)
    "launch_I_Titan_F",          // Titan MPRL (Digital)
    "launch_I_Titan_eaf_F",      // Titan MPRL (Geometric)
    "launch_O_Titan_F",          // Titan MPRL (Hex)
    "launch_O_Titan_ghex_F",     // Titan MPRL (Green Hex)
    "launch_Titan_F"             // Titan MPRL (Base/Generic)
];

function infereRole(loadout: Loadout): UnitRole {
    let role: UnitRole = "Rifleman";

    if (!loadout.weapons) {
        throw Error(`Couldn't infere role for unit: loadout.weapons is null`);
    }

    if (loadout.weapons.primary && loadout.weapons.primary.base) {
        if (antiTankWeapons.includes(loadout.weapons.primary.base)) {
            role = "AT";
        }
        if (antiAirWeapons.includes(loadout.weapons.primary.base)) {
            role = "AA";
        }
    }
    if (loadout.weapons.secondary && loadout.weapons.secondary.base) {
        if (antiTankWeapons.includes(loadout.weapons.secondary.base)) {
            role = "AT";
        }
        if (antiAirWeapons.includes(loadout.weapons.secondary.base)) {
            role = "AA";
        }
    }

    return role;
}

export function createSitrep(group: Group, monitor: GroupCombatMonitor): Sitrep {
    const pos = group.getPosition();
    let status = GroupSitrepStatus.Normal;
    if (monitor.getStatus() == GroupStatus.Engaged) {
        status = GroupSitrepStatus.Engaged;
    }
    const effectiveness = 1.0 - group.getCasualtyRatio();
    const currentTask = group.getCurrentTask();
    let taskSitrep: TaskSitrep | null = null;
    if (currentTask) {
        let destination: Point | null = null;
        if (currentTask.type === "PUSH") {
            const t = currentTask as Push;
            destination = t.getFinalWaypointPosition();
        } else if (currentTask.type === "ASSAULT") {
            const t = currentTask as Push;
            destination = t.getFinalWaypointPosition();
        } else if (currentTask.type === "RETREAT") {
            const t = currentTask as Push;
            destination = t.getFinalWaypointPosition();
        }
        taskSitrep = {
            name: currentTask.name,
            type: currentTask.type,
            behaviour: monitor.getCombatBehaviour(),
            destination: destination,
        }
    }

    const enemies: TrackedEnemy[] = monitor.getKnownEnemies();

    const units = group.getUnits();
    const unitSitreps: UnitSitrep[] = units.map(u => { return infereRole(u.loadout) }).map(r => { return { role: r }; });
    const vehicles = group.getVehicles();
    const vehicleNames = vehicles.map(v => { return v.name });

    return {
        groupName: group.getName(),
        units: unitSitreps,
        vehicles: vehicleNames,
        position: { x: pos.x, y: pos.y },
        status: status,
        effectiveness: effectiveness,
        task: taskSitrep,
        contacts: clusterContacts(enemies)
    }
}

function getDistance(p1: Point3D, p2: Point3D): number {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

export function clusterContacts(enemies: TrackedEnemy[], eps: number = 100, minPts: number = 2): ContactSitrep[] {
    const visited = new Set<number>();
    const clusters: TrackedEnemy[][] = [];

    for (let i = 0; i < enemies.length; i++) {
        if (visited.has(i)) continue;

        const neighbors = findNeighbors(i, enemies, eps);

        if (neighbors.length < minPts) {
            // Noise point (lone unit) - we'll treat them as a cluster of 1 later
            continue;
        }

        const newCluster: TrackedEnemy[] = [];
        expandCluster(i, neighbors, enemies, newCluster, visited, eps, minPts);
        clusters.push(newCluster);
    }

    // Handle "Noise" (lone units) that weren't part of any cluster
    const clusteredPoints = new Set(clusters.flat());
    const loneUnits = enemies.filter(p => !clusteredPoints.has(p));

    // Map clusters to the format you'll send to the LLM
    const results: ContactSitrep[] = clusters.map(group => ({
        kind: group[0].kind,
        count: group.length,
        position: calculateCentroid(group.map(g => g.position))
    }));

    loneUnits.forEach(p => {
        results.push({ kind: p.kind, count: 1, position: { x: p.position.x, y: p.position.y } });
    });

    return results;
}

function findNeighbors(index: number, enemies: TrackedEnemy[], eps: number): number[] {
    const neighbors: number[] = [];
    for (let i = 0; i < enemies.length; i++) {
        if (enemies[index].kind === enemies[i].kind && getDistance(enemies[index].position, enemies[i].position) <= eps) {
            neighbors.push(i);
        }
    }
    return neighbors;
}

function expandCluster(index: number, neighbors: number[], enemies: TrackedEnemy[], cluster: TrackedEnemy[], visited: Set<number>, eps: number, minPts: number) {
    visited.add(index);
    cluster.push(enemies[index]);

    for (let i = 0; i < neighbors.length; i++) {
        const neighborIndex = neighbors[i];
        if (!visited.has(neighborIndex)) {
            visited.add(neighborIndex);
            const nextNeighbors = findNeighbors(neighborIndex, enemies, eps);
            if (nextNeighbors.length >= minPts) {
                neighbors.push(...nextNeighbors);
            }
        }
        // If not already in a cluster, add it
        if (!cluster.includes(enemies[neighborIndex])) {
            cluster.push(enemies[neighborIndex]);
        }
    }
}

function calculateCentroid(points: Point3D[]): Point {
    const sum = points.reduce((acc, p) => ({
        x: acc.x + p.x,
        y: acc.y + p.y
    }), { x: 0, y: 0 });
    return {
        x: sum.x / points.length,
        y: sum.y / points.length
    };
}