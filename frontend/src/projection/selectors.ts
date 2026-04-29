import type {
  AkelaEvent,
  ProjectedContactState,
  ProjectedGroupState,
  ProjectedState,
  StateTickPayload,
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
    return { groups: [], contacts: [], lastTickTime: null, nextTickTime: null };
  }

  const ticks = events
    .filter((event) => event.type === "STATE_TICK")
    .sort((a, b) => a.t - b.t);

  const lastTick = [...ticks].reverse().find((event) => event.t <= currentTime) ?? null;
  const nextTick = ticks.find((event) => event.t > currentTime) ?? null;

  const groupStates = new Map<string, ProjectedGroupState>();
  const contactStates = new Map<string, ProjectedContactState>();

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
      });
    }

    tick.knownEnemies.forEach((enemy, index) => {
      const coords = asNumberArray(enemy.position) ?? [0, 0, 0];
      contactStates.set(`${event.t}-${index}`, {
        id: `${event.t}-${index}`,
        kind: enemy.kind,
        position: [coords[0] ?? 0, coords[1] ?? 0],
      });
    });
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
