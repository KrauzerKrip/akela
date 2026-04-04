import { Task } from "../army";

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

export interface TaskCompletePlanEvent extends PlanEvent {
    type: "TASK_COMPLETE";
    taskName: string;
}

export interface PlanAmmo {
    primaryWeapon: number;
    secondaryWeapon: number;
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
}