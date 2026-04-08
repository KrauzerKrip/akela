import { Group, Push } from "./army";
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

export interface Sitrep {
    groupName: string;
    position: Point;
    status: GroupSitrepStatus;
    effectiveness: number;
    task: TaskSitrep | null;
    contacts: ContactSitrep[];
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

    return {
        groupName: group.getName(),
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