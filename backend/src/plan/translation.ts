import { Army, Group, Task, Waypoint, Push, Assault, Report, Retreat, SequenceTask, Signal, WaitTask, Embark, Disembark } from "../army";
import { Point } from "../geography";
import { PlanGroup, Plan, SyncPoint, PlanVehicle } from "./models";
import { v4 as uuidv4 } from "uuid";

export function translateToPlanGroup(plan: Plan, group: Group): PlanGroup {
    const groupReactions: Record<string, any> = {};

    return {
        id: group.id,
        getCasualties() {
            return group.getCasualties();
        },
        getCasualtyRatio() {
            return group.getCasualtyRatio();
        },
        getAliveUnitCount() {
            return group.getAliveUnitCount();
        },
        enqueue(jsTask) {
            const task = translateTask(jsTask);
            console.log(`[Translation] enqueue: jsTask.id=${jsTask.id}, translatedTaskId=${task.id}`);

            if (!plan.queuedTasks[group.id]) {
                plan.queuedTasks[group.id] = [];
            }
            plan.queuedTasks[group.id].push(task);

            // 3. Merge groupReactions with task specific reactions
            plan.taskReactions[task.id] = { ...groupReactions, ...(jsTask.reactions || {}) };

            console.log(`[Translation] enqueue: Registered reactions for task ${task.id}:`, Object.keys(plan.taskReactions[task.id]));
        },
        executeImmediately(jsTask) {
            const task = translateTask(jsTask);
            console.log(`[Translation] executeImmediately: jsTask.id=${jsTask.id}, translatedTaskId=${task.id}`);

            plan.immediateTasks[group.id] = task;

            // Merge groupReactions with task specific reactions
            plan.taskReactions[task.id] = { ...groupReactions, ...(jsTask.reactions || {}) };

            console.log(`[Translation] executeImmediately: Registered reactions for task ${task.id}:`, Object.keys(plan.taskReactions[task.id]));
        },
        executeAndClearQueue(jsTask) {
            const task = translateTask(jsTask);
            console.log(`[Translation] executeAndClearQueue: jsTask.id=${jsTask.id}, translatedTaskId=${task.id}`);

            plan.immediateTasks[group.id] = task;
            plan.clearGroupTasks[group.id] = true;

            // Merge groupReactions with task specific reactions
            plan.taskReactions[task.id] = { ...groupReactions, ...(jsTask.reactions || {}) };

            console.log(`[Translation] executeAndClearQueue: Registered reactions for task ${task.id}:`, Object.keys(plan.taskReactions[task.id]));
        },
        getVehiclesByName(name: string): PlanVehicle[] {
            const groupVehicles = group.getVehicles();
            const vehicles: PlanVehicle[] = [];
            for (const v of groupVehicles) {
                if (v.name == name) {
                    vehicles.push({ id: v.id, name: v.name });
                }
            }
            return vehicles;
        },
        on(event: string, callback: any) {
            groupReactions[event] = callback;
            return this; // Allows chaining: group.on().on()
        },
    }
}

export function translateTask(jsTask: any): Task {
    const type: string = jsTask.type;
    const name: string = jsTask.name;
    const completionSyncPoint: SyncPoint | null = jsTask.completionSignal;
    let waypoints = [];
    if (jsTask.waypoints) {
        waypoints = jsTask.waypoints.map((wp: any) => ({
            id: uuidv4(),
            position: { x: wp.x, y: wp.y, } as Point
        } as Waypoint));
    }

    let task: Task;
    switch (type) {
        case 'PUSH':
            task = Push.fromWaypoints(waypoints, name)
            break;
        case 'ASSAULT':
            task = Assault.fromWaypoints(waypoints, name);
            break;
        case 'SEQUENCE':
            // Recursively translate children
            const children = jsTask.tasks.map((t: any) => translateTask(t));
            task = SequenceTask.fromTasks(children, name);
            break;
        case 'RETREAT':
            task = Retreat.fromWaypoints(waypoints, name);
            break;
        case 'REPORT':
            const message: string = jsTask.message;
            task = Report.fromMessage(message, name);
            break;
        case 'WAIT':
            const waitSyncPoint = jsTask.signalToWaitFor;
            const waitSignal = translateSyncPoint(waitSyncPoint);
            task = WaitTask.fromSignal(waitSignal, name || null);
            break;
        case 'EMBARK':
            const vehicle: PlanVehicle = jsTask.vehicle;
            task = Embark.fromVehicle({ id: vehicle.id, name: vehicle.name }, jsTask.name);
            break;
        case 'DISEMBARK':
            task = Disembark.withName(jsTask.name);
            break;
        default:
            throw Error(`Unknown task type: ${type}`);
    }

    if (completionSyncPoint) {
        task.setCompletionSignal(translateSyncPoint(completionSyncPoint));
    }

    return task;
}

export function translateSyncPoint(syncPoint: SyncPoint): Signal {
    return { id: syncPoint.id, name: syncPoint.name };
}