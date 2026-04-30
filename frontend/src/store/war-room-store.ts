import { create } from "zustand";
import type { AkelaEvent, SessionManifest, SessionMeta, SessionTrace } from "../types/events";

type PlayMode = "live" | "replay";
const EMPTY_EVENTS: AkelaEvent[] = [];

interface WarRoomState {
  sessions: SessionMeta[];
  activeSession: SessionMeta | null;
  selectedSessionId: string | null;
  manifestBySession: Record<string, SessionManifest | null>;
  tracesBySession: Record<string, SessionTrace[]>;
  eventsBySession: Record<string, AkelaEvent[]>;
  mode: PlayMode;
  currentTime: number | null;
  playbackSpeed: 1 | 2 | 4;
  isPlaying: boolean;
  loadingMap: boolean;
  setSessions: (sessions: SessionMeta[]) => void;
  setActiveSession: (session: SessionMeta | null) => void;
  selectSession: (sessionId: string | null) => void;
  setManifest: (sessionId: string, manifest: SessionManifest | null) => void;
  setTraces: (sessionId: string, traces: SessionTrace[]) => void;
  setSessionEvents: (sessionId: string, events: AkelaEvent[]) => void;
  appendLiveEvent: (sessionId: string, event: AkelaEvent) => void;
  setMode: (mode: PlayMode) => void;
  setCurrentTime: (value: number | null) => void;
  setPlaybackSpeed: (speed: 1 | 2 | 4) => void;
  setPlaying: (value: boolean) => void;
  jumpToLive: () => void;
  setLoadingMap: (value: boolean) => void;
}

function latestEventTime(events: AkelaEvent[]): number | null {
  if (events.length === 0) {
    return null;
  }
  return events[events.length - 1]?.t ?? null;
}

function eventToTrace(event: AkelaEvent, sessionId: string, indexHint: number): SessionTrace | null {
  if (!["LLM_DECISION_START", "AGENT_RESPONSE", "NEW_PLAN"].includes(event.type)) {
    return null;
  }
  const detail =
    typeof event.payload.response === "string"
      ? event.payload.response
      : typeof event.payload.trigger === "string"
        ? event.payload.trigger
        : typeof event.payload.code === "string"
          ? event.payload.code.slice(0, 400)
          : JSON.stringify(event.payload);
  return {
    id: `${sessionId}-live-${event.t}-${event.type}-${indexHint}`,
    t: event.t,
    title: event.type,
    detail,
  };
}

export const useWarRoomStore = create<WarRoomState>((set, get) => ({
  sessions: [],
  activeSession: null,
  selectedSessionId: null,
  manifestBySession: {},
  tracesBySession: {},
  eventsBySession: {},
  mode: "live",
  currentTime: null,
  playbackSpeed: 1,
  isPlaying: false,
  loadingMap: false,
  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (activeSession) => set({ activeSession }),
  selectSession: (selectedSessionId) => {
    const state = get();
    const events = selectedSessionId ? state.eventsBySession[selectedSessionId] ?? [] : [];
    set({
      selectedSessionId,
      currentTime: latestEventTime(events),
    });
  },
  setManifest: (sessionId, manifest) =>
    set((state) => ({
      manifestBySession: { ...state.manifestBySession, [sessionId]: manifest },
    })),
  setTraces: (sessionId, traces) =>
    set((state) => ({
      tracesBySession: { ...state.tracesBySession, [sessionId]: traces },
    })),
  setSessionEvents: (sessionId, events) =>
    set((state) => {
      const sorted = [...events].sort((a, b) => a.t - b.t);
      const selected = state.selectedSessionId === sessionId;
      return {
        eventsBySession: { ...state.eventsBySession, [sessionId]: sorted },
        currentTime: selected ? latestEventTime(sorted) : state.currentTime,
      };
    }),
  appendLiveEvent: (sessionId, event) =>
    set((state) => {
      const existing = state.eventsBySession[sessionId] ?? [];
      const next = [...existing, event].sort((a, b) => a.t - b.t);
      const existingTraces = state.tracesBySession[sessionId] ?? [];
      const liveTrace = eventToTrace(event, sessionId, existingTraces.length);
      const nextTraces = liveTrace ? [...existingTraces, liveTrace] : existingTraces;
      const shouldPinLive =
        state.mode === "live" && (state.selectedSessionId === sessionId || state.selectedSessionId === null);

      return {
        eventsBySession: { ...state.eventsBySession, [sessionId]: next },
        tracesBySession: { ...state.tracesBySession, [sessionId]: nextTraces },
        selectedSessionId: state.selectedSessionId ?? sessionId,
        currentTime: shouldPinLive ? latestEventTime(next) : state.currentTime,
      };
    }),
  setMode: (mode) => set({ mode }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  jumpToLive: () => {
    const state = get();
    const targetSession = state.activeSession?.id ?? state.selectedSessionId;
    if (!targetSession) {
      return;
    }
    const events = state.eventsBySession[targetSession] ?? [];
    set({
      mode: "live",
      isPlaying: false,
      selectedSessionId: targetSession,
      currentTime: latestEventTime(events),
    });
  },
  setLoadingMap: (loadingMap) => set({ loadingMap }),
}));

export function useSelectedSessionEvents(): AkelaEvent[] {
  return useWarRoomStore((state) =>
    state.selectedSessionId ? state.eventsBySession[state.selectedSessionId] ?? EMPTY_EVENTS : EMPTY_EVENTS
  );
}
