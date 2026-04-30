import type {
  AkelaEvent,
  PlanSummary,
  ProjectedContactState,
  ProjectedGroupState,
  ProjectedState,
  StateTickPayload,
  TaskRouteSummary,
  TimelineMarker,
} from "../types/events";

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsed = value.map((entry) => Number(entry));
  if (parsed.some((entry) => Number.isNaN(entry))) {
    return null;
  }
  return parsed;
}

function toStateTickPayload(event: AkelaEvent): StateTickPayload | null {
  if (event.type !== "STATE_TICK") {
    return null;
  }
  const groups = event.payload.groups;
  const knownEnemies = event.payload.knownEnemies;
  if (!Array.isArray(groups) || !Array.isArray(knownEnemies)) {
    return null;
  }
  return {
    groups: groups as StateTickPayload["groups"],
    knownEnemies: knownEnemies as StateTickPayload["knownEnemies"],
  };
}

export function projectStateAtTime(events: AkelaEvent[], currentTime: number | null): ProjectedState {
  if (events.length === 0 || currentTime === null) {
    return { groups: [], contacts: [], currentTaskRoutes: [], plannedTaskRoutes: [], lastTickTime: null, nextTickTime: null };
  }

  const ticks = events
    .filter((event) => event.type === "STATE_TICK")
    .sort((a, b) => a.t - b.t);

  const lastTick = [...ticks].reverse().find((event) => event.t <= currentTime) ?? null;
  const nextTick = ticks.find((event) => event.t > currentTime) ?? null;

  const groupStates = new Map<string, ProjectedGroupState>();
  const contactStates = new Map<string, ProjectedContactState>();
  const currentTaskRoutesByGroup = new Map<string, Array<[number, number]>>();
  const plannedTasksByGroup = new Map<string, Array<{ taskId: string; points: Array<[number, number]> }>>();

  const asRoutePoints = (task: TaskRouteSummary | null | undefined, fallbackStart?: [number, number]): Array<[number, number]> => {
    const waypointPoints = Array.isArray(task?.waypoints)
      ? task.waypoints
          .map((waypoint) => asNumberArray(waypoint)?.slice(0, 2) as [number, number] | undefined)
          .filter((waypoint): waypoint is [number, number] => Boolean(waypoint))
      : [];
    if (fallbackStart) {
      if (waypointPoints.length > 0) {
        return [fallbackStart, ...waypointPoints];
      }
      const destination = asNumberArray(task?.destination)?.slice(0, 2) as [number, number] | undefined;
      if (destination) {
        return [fallbackStart, destination];
      }
    }
    return waypointPoints;
  };

  const upsertPlannedTask = (groupId: string, task: TaskRouteSummary | null | undefined) => {
    if (!task) {
      return;
    }
    const points = asRoutePoints(task);
    if (points.length < 2) {
      return;
    }
    const taskId = task.id ?? `${groupId}-${task.name ?? "planned-task"}`;
    const existing = plannedTasksByGroup.get(groupId) ?? [];
    const withoutTask = existing.filter((entry) => entry.taskId !== taskId);
    withoutTask.push({ taskId, points });
    plannedTasksByGroup.set(groupId, withoutTask);
  };

  const eventsBeforeTime = events.filter((event) => event.t <= currentTime);
  for (const event of eventsBeforeTime) {
    const tick = toStateTickPayload(event);
    if (!tick) {
      continue;
    }

    for (const group of tick.groups) {
      const coords = asNumberArray(group.position) ?? [0, 0];
      groupStates.set(group.groupId, {
        id: group.groupId,
        name: group.name,
        position: [coords[0] ?? 0, coords[1] ?? 0],
        taskName: group.task?.name ?? null,
        taskType: group.task?.type ?? null,
        taskDestination: asNumberArray(group.task?.destination)?.slice(0, 2) as [number, number] | null,
        taskWaypoints: asRoutePoints(group.task).slice(1),
      });
      const routePoints = asRoutePoints(group.task, [coords[0] ?? 0, coords[1] ?? 0]);
      if (routePoints.length >= 2) {
        currentTaskRoutesByGroup.set(group.groupId, routePoints);
      } else {
        currentTaskRoutesByGroup.delete(group.groupId);
      }
    }

    tick.knownEnemies.forEach((enemy, index) => {
      const coords = asNumberArray(enemy.position) ?? [0, 0, 0];
      contactStates.set(`${event.t}-${index}`, {
        id: `${event.t}-${index}`,
        kind: enemy.kind,
        position: [coords[0] ?? 0, coords[1] ?? 0],
      });
    });

    if (event.type === "NEW_PLAN") {
      const planSummary = event.payload.planSummary as PlanSummary | undefined;
      if (Array.isArray(planSummary?.groups)) {
        for (const planGroup of planSummary.groups) {
          const groupId = planGroup.groupId;
          if (!groupId) {
            continue;
          }
          if (planGroup.clearQueue) {
            plannedTasksByGroup.set(groupId, []);
          }
          upsertPlannedTask(groupId, planGroup.immediateTask ?? null);
          const queuedTasks = Array.isArray(planGroup.queuedTasks) ? planGroup.queuedTasks : [];
          for (const queuedTask of queuedTasks) {
            upsertPlannedTask(groupId, queuedTask);
          }
        }
      }
    } else if (event.type === "ORDER_QUEUED") {
      const groupId = typeof event.payload.groupId === "string" ? event.payload.groupId : null;
      const task = event.payload.task as TaskRouteSummary | undefined;
      if (groupId) {
        upsertPlannedTask(groupId, task);
      }
    } else if (event.type === "TASK_STARTED") {
      const groupId = typeof event.payload.groupId === "string" ? event.payload.groupId : null;
      const taskId =
        typeof (event.payload.task as { id?: unknown } | undefined)?.id === "string"
          ? ((event.payload.task as { id?: string }).id ?? null)
          : null;
      if (groupId && taskId) {
        const existing = plannedTasksByGroup.get(groupId) ?? [];
        plannedTasksByGroup.set(
          groupId,
          existing.filter((entry) => entry.taskId !== taskId)
        );
      }
    } else if (event.type === "TASK_COMPLETED") {
      const groupId = typeof event.payload.groupId === "string" ? event.payload.groupId : null;
      const taskId =
        typeof (event.payload.task as { id?: unknown } | undefined)?.id === "string"
          ? ((event.payload.task as { id?: string }).id ?? null)
          : null;
      if (groupId && taskId) {
        const existing = plannedTasksByGroup.get(groupId) ?? [];
        plannedTasksByGroup.set(
          groupId,
          existing.filter((entry) => entry.taskId !== taskId)
        );
      }
    }
  }

  // Lerp group positions between neighboring ticks to avoid teleporting markers.
  if (lastTick && nextTick && nextTick.t > lastTick.t) {
    const prev = toStateTickPayload(lastTick);
    const next = toStateTickPayload(nextTick);
    if (prev && next) {
      const alpha = (currentTime - lastTick.t) / (nextTick.t - lastTick.t);
      const nextById = new Map(next.groups.map((group) => [group.groupId, group]));

      for (const group of prev.groups) {
        const target = nextById.get(group.groupId);
        if (!target) {
          continue;
        }

        const start = asNumberArray(group.position) ?? [0, 0];
        const end = asNumberArray(target.position) ?? start;
        const projected = groupStates.get(group.groupId);
        if (!projected) {
          continue;
        }
        projected.position = [
          start[0] + (end[0] - start[0]) * alpha,
          start[1] + (end[1] - start[1]) * alpha,
        ];
      }
    }
  }

  return {
    groups: [...groupStates.values()],
    contacts: [...contactStates.values()],
    currentTaskRoutes: [...currentTaskRoutesByGroup.entries()].map(([groupId, points]) => ({
      id: `current-${groupId}`,
      points,
    })),
    plannedTaskRoutes: [...plannedTasksByGroup.entries()].flatMap(([groupId, routes]) =>
      routes.map((route) => ({
        id: `planned-${groupId}-${route.taskId}`,
        points: route.points,
      }))
    ),
    lastTickTime: lastTick?.t ?? null,
    nextTickTime: nextTick?.t ?? null,
  };
}

const MARKER_TYPES = new Set([
  "ENEMY_CONTACT",
  "ENGAGED_IN_COMBAT",
  "COMBAT_ENDED",
  "KIA",
  "USER_COMMAND",
  "NEW_PLAN",
  "TASK_COMPLETED",
]);

export function buildTimelineMarkers(events: AkelaEvent[]): TimelineMarker[] {
  return events
    .filter((event) => MARKER_TYPES.has(event.type))
    .map((event, index) => ({
      id: `${event.type}-${event.t}-${index}`,
      t: event.t,
      type: event.type,
      label: event.type.replaceAll("_", " "),
    }));
}
