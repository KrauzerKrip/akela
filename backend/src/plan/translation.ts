import { Army, Group, Task, Waypoint, Push, Assault, Report, Retreat, SequenceTask } from "../army";
import { Point } from "../geography";
import { PlanGroup, Plan } from "./models";
import { v4 as uuidv4 } from "uuid";

export function translateToPlanGroup(plan: Plan, group: Group): PlanGroup {
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
            if (!plan.queuedTasks[group.id]) {
                plan.queuedTasks[group.id] = [];
            }
            plan.queuedTasks[group.id].push(task);
            plan.taskReactions[task.id] = jsTask.reactions || {};
        },
        executeImmediately(jsTask) {
            const task = translateTask(jsTask);
            plan.immediateTasks[group.id] = task;
            plan.taskReactions[task.id] = jsTask.reactions || {};
        },
        executeAndClearQueue(jsTask) {
            const task = translateTask(jsTask);
            plan.immediateTasks[group.id] = task;
            plan.clearGroupTasks[group.id] = true;
            plan.taskReactions[task.id] = jsTask.reactions || {};
        }
    }
}

export function translateTask(jsTask: any): Task {
    const type: string = jsTask.type;
    const name: string = jsTask.name;
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
        default:
            task = new Report(uuidv4(), "Report", jsTask.msg || "No message");
    }

    return task;
}
