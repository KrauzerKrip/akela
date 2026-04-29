import { RadioTower, History } from "lucide-react";
import type { JSX } from "react";
import { useWarRoomStore } from "../../store/war-room-store";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export function SessionSidebar(): JSX.Element {
  const sessions = useWarRoomStore((state) => state.sessions);
  const selectedSessionId = useWarRoomStore((state) => state.selectedSessionId);
  const activeSession = useWarRoomStore((state) => state.activeSession);
  const selectSession = useWarRoomStore((state) => state.selectSession);
  const jumpToLive = useWarRoomStore((state) => state.jumpToLive);
  const setMode = useWarRoomStore((state) => state.setMode);

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
