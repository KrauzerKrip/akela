import { useEffect, useMemo } from "react";
import type { JSX } from "react";
import { fetchActiveSession, fetchSessionEvents, fetchSessionManifest, fetchSessionTraces, fetchSessions } from "../../api/client";
import { CommanderConsole } from "../console/commander-console";
import { MindFeed } from "../feed/mind-feed";
import { ResizablePanels } from "./resizable-panels";
import { SessionSidebar } from "./session-sidebar";
import { WarMap } from "../map/war-map";
import { TimelineControls } from "../timeline/timeline-controls";
import { useLiveEvents } from "../../hooks/use-live-events";
import { usePlaybackClock } from "../../hooks/use-playback-clock";
import { projectStateAtTime } from "../../projection/selectors";
import { useSelectedSessionEvents, useWarRoomStore } from "../../store/war-room-store";

export function WarRoomShell(): JSX.Element {
  const sessions = useWarRoomStore((state) => state.sessions);
  const selectedSessionId = useWarRoomStore((state) => state.selectedSessionId);
  const mode = useWarRoomStore((state) => state.mode);
  const currentTime = useWarRoomStore((state) => state.currentTime);
  const setSessions = useWarRoomStore((state) => state.setSessions);
  const setActiveSession = useWarRoomStore((state) => state.setActiveSession);
  const selectSession = useWarRoomStore((state) => state.selectSession);
  const setSessionEvents = useWarRoomStore((state) => state.setSessionEvents);
  const setManifest = useWarRoomStore((state) => state.setManifest);
  const setTraces = useWarRoomStore((state) => state.setTraces);
  const events = useSelectedSessionEvents();
  const manifest = useWarRoomStore((state) =>
    selectedSessionId ? state.manifestBySession[selectedSessionId] ?? null : null
  );

  usePlaybackClock();
  useLiveEvents(mode === "live");

  useEffect(() => {
    const loadSessions = async () => {
      const [sessionList, activeSession] = await Promise.all([fetchSessions(), fetchActiveSession()]);
      setSessions(sessionList);
      setActiveSession(activeSession);

      if (activeSession?.id) {
        selectSession(activeSession.id);
      } else if (sessionList[0]?.id) {
        selectSession(sessionList[0].id);
      }
    };

    loadSessions().catch((error) => {
      console.error("Failed to load sessions", error);
    });
  }, [selectSession, setActiveSession, setSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const loadSessionData = async () => {
      const [sessionEvents, sessionManifest, traces] = await Promise.all([
        fetchSessionEvents(selectedSessionId),
        fetchSessionManifest(selectedSessionId),
        fetchSessionTraces(selectedSessionId),
      ]);
      setSessionEvents(selectedSessionId, sessionEvents);
      setManifest(selectedSessionId, sessionManifest);
      setTraces(selectedSessionId, traces);
    };

    loadSessionData().catch((error) => {
      console.error("Failed to load session data", error);
    });
  }, [selectedSessionId, setManifest, setSessionEvents, setTraces]);

  const projected = useMemo(() => projectStateAtTime(events, currentTime), [events, currentTime]);

  return (
    <div className="grid h-screen min-h-screen grid-rows-[1fr_auto] bg-background text-foreground">
      <ResizablePanels
        left={<SessionSidebar />}
        right={
          <div className="grid h-full min-h-0 grid-cols-[2fr_1fr]">
            <WarMap projectedState={projected} manifest={manifest} />
            <div className="grid min-h-0 grid-rows-[1fr_auto]">
              <MindFeed />
              <CommanderConsole />
            </div>
          </div>
        }
      />
      <TimelineControls />
      {sessions.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/85 text-sm text-zinc-300">
          Waiting for Akela session data...
        </div>
      ) : null}
    </div>
  );
}
