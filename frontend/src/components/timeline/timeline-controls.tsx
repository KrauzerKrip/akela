import { Pause, Play, SkipForward } from "lucide-react";
import type { JSX } from "react";
import { buildTimelineMarkers } from "../../projection/selectors";
import { useSelectedSessionEvents, useWarRoomStore } from "../../store/war-room-store";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { clamp, formatClock } from "../../lib/utils";

export function TimelineControls(): JSX.Element {
  const events = useSelectedSessionEvents();
  const mode = useWarRoomStore((state) => state.mode);
  const isPlaying = useWarRoomStore((state) => state.isPlaying);
  const playbackSpeed = useWarRoomStore((state) => state.playbackSpeed);
  const currentTime = useWarRoomStore((state) => state.currentTime);
  const setCurrentTime = useWarRoomStore((state) => state.setCurrentTime);
  const setMode = useWarRoomStore((state) => state.setMode);
  const setPlaying = useWarRoomStore((state) => state.setPlaying);
  const setPlaybackSpeed = useWarRoomStore((state) => state.setPlaybackSpeed);
  const jumpToLive = useWarRoomStore((state) => state.jumpToLive);

  const minTime = events[0]?.t ?? null;
  const maxTime = events[events.length - 1]?.t ?? null;
  const markers = buildTimelineMarkers(events);
  const range = minTime !== null && maxTime !== null ? maxTime - minTime : 0;

  const sliderValue =
    minTime !== null && maxTime !== null
      ? clamp(currentTime ?? maxTime, minTime, maxTime)
      : 0;

  return (
    <div className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setMode("replay");
              setPlaying(!isPlaying);
            }}
          >
            {isPlaying ? <Pause className="mr-1 h-4 w-4" /> : <Play className="mr-1 h-4 w-4" />}
            {isPlaying ? "Pause" : "Play"}
          </Button>
          {[1, 2, 4].map((speed) => (
            <Button
              key={speed}
              variant={playbackSpeed === speed ? "default" : "ghost"}
              size="sm"
              onClick={() => {
                setMode("replay");
                setPlaybackSpeed(speed as 1 | 2 | 4);
              }}
            >
              {speed}x
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={jumpToLive}>
            <SkipForward className="mr-1 h-4 w-4" />
            Jump to Live
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Badge>{mode.toUpperCase()}</Badge>
          <Badge>{formatClock(currentTime)}</Badge>
        </div>
      </div>

      <div className="relative">
        <input
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800"
          type="range"
          min={minTime ?? 0}
          max={maxTime ?? 1}
          step={100}
          value={sliderValue}
          disabled={minTime === null || maxTime === null}
          onChange={(event) => {
            setMode("replay");
            setPlaying(false);
            setCurrentTime(Number(event.currentTarget.value));
          }}
        />
        {range > 0 &&
          markers.map((marker) => (
            <span
              key={marker.id}
              className="pointer-events-none absolute top-0 h-2 w-0.5 bg-red-500"
              style={{
                left: `${((marker.t - (minTime ?? 0)) / range) * 100}%`,
              }}
              title={marker.label}
            />
          ))}
      </div>
    </div>
  );
}
