import { Task } from "../army";

export interface Plan {
    immediateTasks: Record<string, Task>;
    queuedTasks: Record<string, Task[]>;
}

export interface PlanEvent {
    type: string;
}

export interface KiaPlanEvent extends PlanEvent {
    type: "KIA";
}

export interface TaskCompletePlanEvent extends PlanEvent {
    type: "TASK_COMPLETE";
    taskName: string;
}

export interface PlanAmmo {
    primaryWeapon: number;
    secondaryWeapon: number;
}

export interface PlanGroup {
    getCasualtyRatio(): number;
    getCasualties(): number
    getAliveUnitCount(): number;
    //getAverageAmmo(): PlanAmmo;
}