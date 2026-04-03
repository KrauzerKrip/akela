import { Army, Group, Task, Waypoint, Push, Assault, Report, Retreat, SequenceTask } from "../army";
import { Point } from "../geography";
import { PlanGroup } from "./models";
import { v4 as uuidv4 } from "uuid";

export function translateToPlanGroup(group: Group): PlanGroup {
    return {
        getCasualties() {
            return group.getCasualties();
        },
        getCasualtyRatio() {
            return group.getCasualtyRatio();
        },
        getAliveUnitCount() {
            return group.getAliveUnitCount();
        }
    }
}

export function translateTask(jsTask: any): Task {
    const type: string = jsTask.type;
    const name: string = jsTask.name;
    // Fallback to contextGroup if no teamId is explicitly provided in the task
    if (!jsTask.assignedGroupId) {
        throw Error("Task must be assigned to a group")
    }

    let task: Task;
    switch (type) {
        case 'PUSH':
        case 'ASSAULT':
            const waypoints = jsTask.waypoints.map((wp: any) => ({
                id: uuidv4(),
                position: { x: wp.x, y: wp.y, } as Point
            } as Waypoint));
            task = type === 'PUSH'
                ? Push.fromWaypoints(waypoints, name)
                : Assault.fromWaypoints(waypoints, name);
            break;

        case 'SEQUENCE':
            // Recursively translate children
            const children = jsTask.tasks.map((t: any) => translateTask(t));
            task = SequenceTask.fromTasks(children, name);
            break;

        case 'RETREAT':
            task = Retreat.create(name);
            break;

        default:
            task = new Report(uuidv4(), "Report", jsTask.msg || "No message");
    }

    return task;
}
