import { Army, Disembark, Embark, Group, SequenceTask, Task, WaitTask } from "../army";
import { Plan } from "./models";

const MOVEMENT_TASK_TYPES = new Set(["PUSH", "ASSAULT", "RETREAT"]);

interface GroupTaskRef {
    group: Group;
    task: Task;
}

class TransportValidationIssue {
    constructor(
        public readonly code: string,
        public readonly message: string,
        public readonly hint: string,
    ) { }
}

export class TransportValidationError extends Error {
    public readonly issues: TransportValidationIssue[];

    constructor(issues: TransportValidationIssue[]) {
        super(buildErrorMessage(issues));
        this.name = "TransportValidationError";
        this.issues = issues;
    }
}

function buildErrorMessage(issues: TransportValidationIssue[]): string {
    const lines = ["Transport plan validation failed:"];
    for (const issue of issues) {
        lines.push(`- [${issue.code}] ${issue.message}`);
        lines.push(`  Hint: ${issue.hint}`);
    }
    return lines.join("\n");
}

function collectGroupTasks(plan: Plan, group: Group): Task[] {
    const tasks: Task[] = [];
    const immediate = plan.immediateTasks[group.id];
    if (immediate) {
        tasks.push(immediate);
    }
    const queued = plan.queuedTasks[group.id] ?? [];
    tasks.push(...queued);
    return tasks;
}

function flattenTasks(tasks: Task[]): Task[] {
    const flattened: Task[] = [];
    for (const task of tasks) {
        if (task instanceof SequenceTask) {
            flattened.push(...flattenTasks(task.getTasks()));
            continue;
        }
        flattened.push(task);
    }
    return flattened;
}

function hasMovementTask(task: Task): boolean {
    return MOVEMENT_TASK_TYPES.has(task.type);
}

function findEmbarkRefs(army: Army, plan: Plan): GroupTaskRef[] {
    const refs: GroupTaskRef[] = [];
    for (const group of army.getGroups()) {
        const flattened = flattenTasks(collectGroupTasks(plan, group));
        for (const task of flattened) {
            if (task instanceof Embark) {
                refs.push({ group, task });
            }
        }
    }
    return refs;
}

function buildVehicleOwnerMap(army: Army): Map<string, Group> {
    const ownerMap = new Map<string, Group>();
    for (const group of army.getGroups()) {
        for (const vehicle of group.getVehicles()) {
            ownerMap.set(vehicle.id, group);
        }
    }
    return ownerMap;
}

function hasTimeoutReaction(plan: Plan, groupId: string, taskId: string): boolean {
    return Boolean(plan.groupReactions[groupId]?.TIMEOUT || plan.taskReactions[taskId]?.TIMEOUT);
}

function validateInfantryMountedOrdering(
    issues: TransportValidationIssue[],
    group: Group,
    embarkTask: Embark,
    flattenedTasks: Task[],
) {
    const embarkIndex = flattenedTasks.findIndex((task) => task.id === embarkTask.id);
    if (embarkIndex < 0) {
        return;
    }

    let disembarkIndex = -1;
    for (let i = embarkIndex + 1; i < flattenedTasks.length; i += 1) {
        if (flattenedTasks[i] instanceof Disembark) {
            disembarkIndex = i;
            break;
        }
    }

    const windowEnd = disembarkIndex === -1 ? flattenedTasks.length : disembarkIndex;
    for (let i = embarkIndex + 1; i < windowEnd; i += 1) {
        const task = flattenedTasks[i];
        if (hasMovementTask(task)) {
            issues.push(new TransportValidationIssue(
                "INFANTRY_MOVES_WHILE_MOUNTED",
                `Group "${group.getName()}" has movement task "${task.name}" (${task.type}) after Embark "${embarkTask.name}" but before Disembark.`,
                `Move "${task.name}" after a synced Disembark. Example: new Disembark("Unload").signals(disembarkDone) + infantry Wait(disembarkDone).`,
            ));
        }
    }

    if (disembarkIndex === -1) {
        issues.push(new TransportValidationIssue(
            "INFANTRY_DISEMBARK_MISSING",
            `Group "${group.getName()}" embarks via "${embarkTask.name}" but never queues Disembark.`,
            `Queue infantry-side dismount: new Wait(dropoffReady, "...") + new Disembark("Unload infantry").signals(dismounted).`,
        ));
    }
}

function validateVehicleWaitBeforeMovement(
    issues: TransportValidationIssue[],
    ownerGroup: Group,
    embarkTask: Embark,
    embarkSignalId: string,
    plan: Plan,
) {
    const ownerTasks = flattenTasks(collectGroupTasks(plan, ownerGroup));
    const firstDisembarkIndex = ownerTasks.findIndex((task) => task instanceof Disembark);
    const movementWindowEnd = firstDisembarkIndex === -1 ? ownerTasks.length : firstDisembarkIndex;
    let sawRequiredWait = false;

    for (let i = 0; i < movementWindowEnd; i += 1) {
        const task = ownerTasks[i];
        if (task instanceof WaitTask && task.signalToWaitFor.id === embarkSignalId) {
            sawRequiredWait = true;
        }
        if (hasMovementTask(task) && !sawRequiredWait) {
            issues.push(new TransportValidationIssue(
                "VEHICLE_MOVES_BEFORE_EMBARK_SYNC",
                `Vehicle owner group "${ownerGroup.getName()}" moves via "${task.name}" before waiting for embark completion from "${embarkTask.name}".`,
                `Add new Wait(embarkDone, "...") to "${ownerGroup.getName()}" before any movement task and ensure embark task calls .signals(embarkDone).`,
            ));
            break;
        }
    }
}

function validateVehicleOwnerDoesNotDisembark(
    issues: TransportValidationIssue[],
    ownerGroup: Group,
    infantryGroup: Group,
    embarkTask: Embark,
    plan: Plan,
) {
    const ownerTasks = flattenTasks(collectGroupTasks(plan, ownerGroup));
    const ownerDisembark = ownerTasks.find((task) => task instanceof Disembark);
    if (!ownerDisembark) {
        return;
    }

    issues.push(new TransportValidationIssue(
        "VEHICLE_GROUP_DISEMBARK_FORBIDDEN",
        `Vehicle owner group "${ownerGroup.getName()}" queues Disembark "${ownerDisembark.name}" for infantry embark "${embarkTask.name}" from "${infantryGroup.getName()}".`,
        `Assign Disembark to passenger infantry group "${infantryGroup.getName()}". Vehicle group should signal a dropoff SyncPoint after movement; infantry waits that SyncPoint, then disembarks.`,
    ));
}

export function validateTransportPlan(army: Army, plan: Plan): void {
    const issues: TransportValidationIssue[] = [];
    const embarkRefs = findEmbarkRefs(army, plan);
    if (embarkRefs.length === 0) {
        return;
    }

    const vehicleOwnerById = buildVehicleOwnerMap(army);

    for (const { group, task } of embarkRefs) {
        const embarkTask = task as Embark;
        const completionSignal = embarkTask.getCompletionSignal();
        if (!completionSignal) {
            issues.push(new TransportValidationIssue(
                "EMBARK_MISSING_SIGNAL",
                `Group "${group.getName()}" has Embark task "${embarkTask.name}" without .signals(SyncPoint).`,
                `Use: const embarkDone = new SyncPoint("..."); new Embark(vehicle, "${embarkTask.name}").signals(embarkDone).`,
            ));
            continue;
        }

        if (!hasTimeoutReaction(plan, group.id, embarkTask.id)) {
            issues.push(new TransportValidationIssue(
                "EMBARK_TIMEOUT_HANDLER_MISSING",
                `Group "${group.getName()}" Embark task "${embarkTask.name}" has no TIMEOUT contingency reaction.`,
                `Add either group.on(Event.TIMEOUT, ...) or Embark(...).on(Event.TIMEOUT, (event, g) => { g.executeImmediately(...); }).`,
            ));
        }

        const groupTasks = flattenTasks(collectGroupTasks(plan, group));
        validateInfantryMountedOrdering(issues, group, embarkTask, groupTasks);

        const ownerGroup = vehicleOwnerById.get(embarkTask.vehicle.id);
        if (!ownerGroup) {
            issues.push(new TransportValidationIssue(
                "EMBARK_VEHICLE_OWNER_NOT_FOUND",
                `Embark task "${embarkTask.name}" references vehicle "${embarkTask.vehicle.name}" (${embarkTask.vehicle.id}) that is not assigned to any known group.`,
                `Use groups["OwnerGroup"].getVehiclesByName("VehicleClass")[0] and verify the owner group is present in SITREP.`,
            ));
            continue;
        }

        validateVehicleWaitBeforeMovement(
            issues,
            ownerGroup,
            embarkTask,
            completionSignal.id,
            plan,
        );

        validateVehicleOwnerDoesNotDisembark(
            issues,
            ownerGroup,
            group,
            embarkTask,
            plan,
        );
    }

    if (issues.length > 0) {
        throw new TransportValidationError(issues);
    }
}
