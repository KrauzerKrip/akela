import type { AkelaEvent, SessionManifest, SessionMeta, SessionTrace } from "../types/events";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function buildApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function normalizeEvent(raw: Record<string, unknown>): AkelaEvent {
  const t = typeof raw.t === "number" ? raw.t : Date.now();
  const source = (raw.source ?? "SYSTEM") as AkelaEvent["source"];
  const type = String(raw.type ?? "UNKNOWN");
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId : undefined;

  const payload: Record<string, unknown> = { ...raw };
  delete payload.t;
  delete payload.source;
  delete payload.type;
  delete payload.sessionId;

  return { t, source, type, sessionId, payload };
}

export async function fetchSessions(): Promise<SessionMeta[]> {
  const response = await fetch(buildApiUrl("/api/sessions"));
  if (!response.ok) {
    throw new Error("Failed to load sessions.");
  }
  return (await response.json()) as SessionMeta[];
}

export async function fetchActiveSession(): Promise<SessionMeta | null> {
  const response = await fetch(buildApiUrl("/api/sessions/active"));
  if (!response.ok) {
    throw new Error("Failed to load active session.");
  }
  return (await response.json()) as SessionMeta | null;
}

export async function fetchSessionEvents(sessionId: string): Promise<AkelaEvent[]> {
  const response = await fetch(buildApiUrl(`/api/sessions/${sessionId}/events`));
  if (!response.ok) {
    throw new Error("Failed to load session events.");
  }

  const events = (await response.json()) as Array<Record<string, unknown>>;
  return events.map(normalizeEvent);
}

export async function fetchSessionManifest(sessionId: string): Promise<SessionManifest | null> {
  const response = await fetch(buildApiUrl(`/api/sessions/${sessionId}/manifest`));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Failed to load session manifest.");
  }
  return (await response.json()) as SessionManifest;
}

export async function fetchSessionTraces(sessionId: string): Promise<SessionTrace[]> {
  const response = await fetch(buildApiUrl(`/api/sessions/${sessionId}/traces`));
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { traces?: SessionTrace[] };
  return body.traces ?? [];
}

export async function sendIntervention(
  sessionId: string,
  targetAgent: string,
  message: string
): Promise<void> {
  const response = await fetch(buildApiUrl(`/api/sessions/${sessionId}/intervene`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetAgent, message }),
  });
  if (!response.ok) {
    throw new Error("Failed to send intervention.");
  }
}

export function getMapCropUrl(
  world: string,
  bbox: { x1: number; y1: number; x2: number; y2: number }
): string {
  const query = new URLSearchParams({
    world,
    x1: String(bbox.x1),
    y1: String(bbox.y1),
    x2: String(bbox.x2),
    y2: String(bbox.y2),
  });
  return buildApiUrl(`/api/map/crop?${query.toString()}`);
}

export function connectLiveEvents(onEvent: (event: AkelaEvent) => void): WebSocket {
  const wsBase = API_BASE.replace(/^http/, "ws");
  const socket = new WebSocket(`${wsBase}/api/events/live`);

  socket.addEventListener("message", (message) => {
    try {
      const parsed = JSON.parse(String(message.data)) as Record<string, unknown>;
      onEvent(normalizeEvent(parsed));
    } catch {
      // Ignore malformed payloads to keep stream resilient.
    }
  });

  return socket;
}
