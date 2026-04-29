import { useEffect, useMemo, useRef, type JSX } from "react";
import { useSelectedSessionEvents, useWarRoomStore } from "../../store/war-room-store";
import { Badge } from "../ui/badge";
import { formatClock } from "../../lib/utils";

const EMPTY_TRACES: Array<{ id: string; title: string; detail: string; t: number }> = [];

function toYamlLike(event: { type: string; source: string; t: number; payload: Record<string, unknown> }): string {
  const lines = [`type: ${event.type}`, `source: ${event.source}`, `t: ${new Date(event.t).toISOString()}`];
  for (const [key, value] of Object.entries(event.payload)) {
    const printable = typeof value === "string" ? value : JSON.stringify(value);
    lines.push(`${key}: ${printable}`);
  }
  return lines.join("\n");
}

export function MindFeed(): JSX.Element {
  const events = useSelectedSessionEvents();
  const selectedSessionId = useWarRoomStore((state) => state.selectedSessionId);
  const currentTime = useWarRoomStore((state) => state.currentTime);
  const traces = useWarRoomStore((state) =>
    selectedSessionId ? state.tracesBySession[selectedSessionId] ?? EMPTY_TRACES : EMPTY_TRACES
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  const feedItems = useMemo(
    () =>
      events.filter((event) =>
        ["STATE_TICK", "TACTICAL_REPORT", "AGENT_RESPONSE", "USER_COMMAND", "NEW_PLAN", "COMPOSITION_PROGRESS"].includes(
          event.type
        )
      ),
    [events]
  );

  const activeIndex = feedItems.findLastIndex((event) => (currentTime ? event.t <= currentTime : false));

  useEffect(() => {
    if (!containerRef.current || activeIndex < 0) {
      return;
    }
    const target = containerRef.current.querySelector(`[data-feed-index="${activeIndex}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeIndex]);

  return (
    <section className="grid min-h-0 grid-rows-2 border-l border-zinc-800 bg-zinc-950">
      <div className="min-h-0 border-b border-zinc-800">
        <header className="flex items-center justify-between px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">SITREP Stream</h3>
          <Badge>{feedItems.length}</Badge>
        </header>
        <div ref={containerRef} className="h-[calc(100%-36px)] overflow-y-auto px-3 pb-3">
          {feedItems.map((event, index) => (
            <article
              key={`${event.type}-${event.t}-${index}`}
              data-feed-index={index}
              className={`mb-2 rounded border p-2 font-mono text-xs ${
                index === activeIndex ? "border-blue-500 bg-blue-500/10" : "border-zinc-800 bg-zinc-900"
              }`}
            >
              <div className="mb-1 flex items-center justify-between text-zinc-400">
                <span>{event.type}</span>
                <span>{formatClock(event.t)}</span>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-zinc-200">{toYamlLike(event)}</pre>
            </article>
          ))}
        </div>
      </div>

      <div className="min-h-0">
        <header className="flex items-center justify-between px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-300">Thought Trace</h3>
          <Badge>{traces.length}</Badge>
        </header>
        <div className="h-[calc(100%-36px)] overflow-y-auto px-3 pb-3">
          {traces.length === 0 ? (
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400">
              No trace data available for this session yet.
            </div>
          ) : (
            traces.map((trace) => (
              <article key={trace.id} className="mb-2 rounded border border-zinc-800 bg-zinc-900 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-200">{trace.title}</p>
                  <span className="font-mono text-[11px] text-zinc-500">{formatClock(trace.t)}</span>
                </div>
                <p className="font-mono text-xs text-zinc-300">{trace.detail}</p>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
