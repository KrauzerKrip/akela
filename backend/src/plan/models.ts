import { Task } from "../army";
import { v4 as uuidv4 } from "uuid";

export interface Plan {
    immediateTasks: Record<string, Task>;
    queuedTasks: Record<string, Task[]>;
    clearGroupTasks: Record<string, boolean>; // signals if the group task queue should be cleared
    taskReactions: Record<string, Record<string, any>>; // taskId, Record<eventType, jsCallback>
}

export interface PlanEvent {
    type: string;
}


export interface KiaPlanEvent extends PlanEvent {
    type: "KIA";
}

export interface EnemyContactPlanEvent extends PlanEvent {
    type: "ENEMY_CONTACT";
    count: number;
    kind: "Soldier" | "Tank" | "WheeledAPC" | "TrackedAPC" | "Helicopter" | "Plane" | "Ship" | "StaticWeapon" | "Car";
}

export interface EngagedInCombatPlanEvent extends PlanEvent {
    type: "ENGAGED_IN_COMBAT";
}

export interface CombatEndedPlanEvent extends PlanEvent {
    type: "COMBAT_ENDED";
}

export interface SyncPoint {
    id: string;
    name: string;
}

export interface TaskCompletePlanEvent extends PlanEvent {
    type: "TASK_COMPLETE";
    taskName: string;
}

export interface PlanAmmo {
    primaryWeapon: number;
    secondaryWeapon: number;
}

export interface PlanVehicle {
    readonly id: string;
    name: string;
}

export interface PlanGroup {
    id: string;
    getCasualtyRatio(): number;
    getCasualties(): number
    getAliveUnitCount(): number;
    //getAverageAmmo(): PlanAmmo;
    enqueue(jsTask: any): void;
    executeImmediately(jsTask: any): void;
    executeAndClearQueue(jsTask: any): void;
    getVehiclesByName(name: string): PlanVehicle[];
}