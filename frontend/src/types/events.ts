export type EventSource = "GAME" | "AI" | "USER" | "SYSTEM";

export interface SessionMeta {
  id: string;
  worldName: string | null;
  missionName: string | null;
  startTime: string | null;
}

export interface AkelaEvent {
  t: number;
  type: string;
  source: EventSource;
  sessionId?: string;
  payload: Record<string, unknown>;
}

export interface StateTickGroup {
  id: string;
  groupId: string;
  name: string;
  position: [number, number] | [number, number, number];
  task?: {
    id?: string;
    name?: string;
    type?: string;
    destination?: [number, number] | [number, number, number];
  } | null;
}

export interface StateTickEnemy {
  position: [number, number] | [number, number, number];
  kind: string;
}

export interface StateTickPayload {
  groups: StateTickGroup[];
  knownEnemies: StateTickEnemy[];
}

export interface TimelineMarker {
  id: string;
  t: number;
  type: string;
  label: string;
}

export interface ProjectedGroupState {
  id: string;
  name: string;
  position: [number, number];
  taskName: string | null;
  taskType: string | null;
  taskDestination: [number, number] | null;
}

export interface ProjectedContactState {
  id: string;
  position: [number, number];
  kind: string;
}

export interface ProjectedState {
  groups: ProjectedGroupState[];
  contacts: ProjectedContactState[];
  lastTickTime: number | null;
  nextTickTime: number | null;
}

export interface SessionManifest {
  intelInput?: {
    missionName?: string;
    area?: {
      world?: string;
      x1?: number;
      y1?: number;
      x2?: number;
      y2?: number;
    };
  };
  intelResult?: string;
  planningResult?: {
    description?: string;
    code?: string;
  };
  executionEvents?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SessionTrace {
  id: string;
  t: number;
  title: string;
  detail: string;
}

export type CompositionPhase =
  | "STARTED"
  | "GROUP"
  | "UNIT"
  | "LOADOUT"
  | "WAYPOINTS"
  | "VEHICLES"
  | "COMPLETED"
  | "FAILED";

export interface CompositionProgressPayload {
  phase: CompositionPhase;
  message: string;
  index?: number;
  total?: number;
  groupId?: string;
  groupName?: string;
  unitId?: string;
  unitName?: string;
}

export interface SessionInitializePayload {
  intel: {
    photos?: string[];
    observations?: string[];
  };
  area: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    world?: string;
  };
  missionName?: string;
  worldName?: string;
  side?: string;
}

export interface SessionInitializeResponse {
  status: string;
  session: SessionMeta;
}
