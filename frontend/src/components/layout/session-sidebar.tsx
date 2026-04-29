import { RadioTower, History } from "lucide-react";
import { useMemo, useState, type JSX } from "react";
import { useWarRoomStore } from "../../store/war-room-store";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { initializeSession, SessionInitializeError } from "../../api/client";
import type { CompositionProgressPayload, SessionInitializePayload } from "../../types/events";

interface SessionSidebarProps {
  onSessionInitialized: () => Promise<void>;
}

const DEFAULT_INIT_PAYLOAD = `{
  "missionName": "Operation Name",
  "worldName": "Altis",
  "side": "BLUFOR",
  "intel": {
    "photos": [],
    "observations": ["Initial battlefield observation"]
  },
  "area": {
    "x1": 0,
    "y1": 0,
    "x2": 1000,
    "y2": 1000,
    "world": "Altis"
  }
}`;

function parsePayload(raw: string): SessionInitializePayload {
  const parsed = JSON.parse(raw) as SessionInitializePayload;
  if (!parsed.intel || !parsed.area) {
    throw new Error("Payload must include both intel and area.");
  }
  return parsed;
}

function toCompositionProgress(payload: Record<string, unknown>): CompositionProgressPayload | null {
  if (typeof payload.phase !== "string" || typeof payload.message !== "string") {
    return null;
  }
  return payload as unknown as CompositionProgressPayload;
}

function toPipelineFailureMessage(payload: Record<string, unknown>): string | null {
  if (typeof payload.message !== "string" || payload.message.trim().length === 0) {
    return null;
  }
  return payload.message;
}

export function SessionSidebar({ onSessionInitialized }: SessionSidebarProps): JSX.Element {
  const sessions = useWarRoomStore((state) => state.sessions);
  const selectedSessionId = useWarRoomStore((state) => state.selectedSessionId);
  const activeSession = useWarRoomStore((state) => state.activeSession);
  const eventsBySession = useWarRoomStore((state) => state.eventsBySession);
  const selectSession = useWarRoomStore((state) => state.selectSession);
  const jumpToLive = useWarRoomStore((state) => state.jumpToLive);
  const setMode = useWarRoomStore((state) => state.setMode);
  const [initJson, setInitJson] = useState(DEFAULT_INIT_PAYLOAD);
  const [initError, setInitError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  const latestProgress = useMemo(() => {
    const targetSessionId = activeSession?.id ?? selectedSessionId;
    if (!targetSessionId) {
      return null;
    }
    const events = eventsBySession[targetSessionId] ?? [];
    const progressEvents = events.filter((event) => event.type === "COMPOSITION_PROGRESS");
    const latest = progressEvents[progressEvents.length - 1];
    if (!latest) {
      return null;
    }
    return toCompositionProgress(latest.payload);
  }, [activeSession?.id, eventsBySession, selectedSessionId]);

  const latestPipelineFailure = useMemo(() => {
    const targetSessionId = activeSession?.id ?? selectedSessionId;
    if (!targetSessionId) {
      return null;
    }
    const events = eventsBySession[targetSessionId] ?? [];
    const failureEvents = events.filter((event) => event.type === "PIPELINE_FAILED");
    const latest = failureEvents[failureEvents.length - 1];
    if (!latest) {
      return null;
    }
    return toPipelineFailureMessage(latest.payload);
  }, [activeSession?.id, eventsBySession, selectedSessionId]);

  const handleInitialize = async () => {
    setInitError(null);
    setIsInitializing(true);
    try {
      const payload = parsePayload(initJson);
      await initializeSession(payload);
      await onSessionInitialized();
      jumpToLive();
      setMode("live");
    } catch (error) {
      if (error instanceof SyntaxError) {
        setInitError("Initialization payload is not valid JSON.");
      } else if (error instanceof SessionInitializeError && error.statusCode === 409) {
        setInitError("An active session already exists. Stop it before creating a new one.");
      } else if (error instanceof Error) {
        setInitError(error.message);
      } else {
        setInitError("Failed to initialize session.");
      }
    } finally {
      setIsInitializing(false);
    }
  };

  return (
    <aside className="flex h-full flex-col bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h1 className="text-sm font-semibold uppercase tracking-wide text-zinc-200">Sessions</h1>
        <p className="mt-1 text-xs text-zinc-500">General's War Room</p>
      </div>

      <div className="border-b border-zinc-800 px-4 py-3">
        <Button
          className="w-full justify-start"
          variant={activeSession ? "default" : "secondary"}
          size="sm"
          disabled={!activeSession}
          onClick={() => {
            jumpToLive();
            setMode("live");
          }}
        >
          <RadioTower className="mr-2 h-4 w-4" />
          Switch to Live
        </Button>
        <textarea
          className="mt-3 h-32 w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-200"
          value={initJson}
          onChange={(event) => setInitJson(event.target.value)}
          spellCheck={false}
        />
        <Button
          className="mt-2 w-full justify-center"
          variant="secondary"
          size="sm"
          disabled={isInitializing}
          onClick={() => {
            void handleInitialize();
          }}
        >
          {isInitializing ? "Initializing..." : "Initialize Session"}
        </Button>
        {latestProgress ? (
          <p className="mt-2 text-xs text-zinc-400">
            {latestProgress.phase}: {latestProgress.message}
            {latestProgress.total ? ` (${latestProgress.index ?? 0}/${latestProgress.total})` : ""}
          </p>
        ) : null}
        {latestPipelineFailure ? (
          <p className="mt-2 rounded-md border border-rose-700/60 bg-rose-950/40 px-2 py-1 text-xs text-rose-300">
            Pipeline failed: {latestPipelineFailure}
          </p>
        ) : null}
        {initError ? <p className="mt-2 text-xs text-rose-400">{initError}</p> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {sessions.map((session) => (
          <button
            key={session.id}
            className={cn(
              "mb-2 w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
              selectedSessionId === session.id
                ? "border-blue-500 bg-blue-500/10 text-zinc-100"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            )}
            onClick={() => {
              selectSession(session.id);
              setMode(session.id === activeSession?.id ? "live" : "replay");
            }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="truncate font-medium">{session.worldName ?? "Unknown world"}</span>
              {session.id === activeSession?.id ? (
                <RadioTower className="h-4 w-4 text-blue-400" />
              ) : (
                <History className="h-4 w-4 text-zinc-500" />
              )}
            </div>
            <p className="truncate text-xs text-zinc-400">{session.missionName ?? "Unknown mission"}</p>
            <p className="mt-1 font-mono text-[11px] text-zinc-500">{session.startTime ?? session.id}</p>
          </button>
        ))}
      </div>
    </aside>
  );
}
