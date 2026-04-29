import { useEffect } from "react";
import { clamp } from "../lib/utils";
import { useSelectedSessionEvents, useWarRoomStore } from "../store/war-room-store";

export function usePlaybackClock(): void {
  const events = useSelectedSessionEvents();
  const mode = useWarRoomStore((state) => state.mode);
  const isPlaying = useWarRoomStore((state) => state.isPlaying);
  const playbackSpeed = useWarRoomStore((state) => state.playbackSpeed);
  const currentTime = useWarRoomStore((state) => state.currentTime);
  const setCurrentTime = useWarRoomStore((state) => state.setCurrentTime);
  const setPlaying = useWarRoomStore((state) => state.setPlaying);

  useEffect(() => {
    if (mode !== "replay" || !isPlaying || events.length === 0) {
      return;
    }

    const minTime = events[0].t;
    const maxTime = events[events.length - 1].t;
    let lastFrame = performance.now();
    const start = currentTime ?? minTime;
    let rafId = 0;

    const tick = (frame: number) => {
      const elapsed = frame - lastFrame;
      lastFrame = frame;
      const next = clamp(start + elapsed * playbackSpeed, minTime, maxTime);
      setCurrentTime(next);
      if (next >= maxTime) {
        setPlaying(false);
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [mode, isPlaying, events, playbackSpeed, currentTime, setCurrentTime, setPlaying]);
}
