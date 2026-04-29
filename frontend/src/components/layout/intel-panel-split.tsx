import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type JSX } from "react";
import { Button } from "../ui/button";

const LS_WIDTH = "akela.warRoom.intelWidthPx";
const LS_COLLAPSED = "akela.warRoom.intelCollapsed";
const MIN_INTEL = 240;
const MAX_INTEL = 560;
const DEFAULT_INTEL = 360;

function loadInitialWidth(): number {
  if (typeof localStorage === "undefined") {
    return DEFAULT_INTEL;
  }
  const n = Number(localStorage.getItem(LS_WIDTH));
  if (!Number.isFinite(n)) {
    return DEFAULT_INTEL;
  }
  return Math.min(MAX_INTEL, Math.max(MIN_INTEL, n));
}

interface IntelPanelSplitProps {
  map: ReactNode;
  intel: ReactNode;
}

export function IntelPanelSplit({ map, intel }: IntelPanelSplitProps): JSX.Element {
  const [intelWidth, setIntelWidth] = useState(loadInitialWidth);
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(LS_COLLAPSED) === "1"
  );
  const widthDragRef = useRef(intelWidth);

  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    widthDragRef.current = intelWidth;
  }, [intelWidth]);

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = widthDragRef.current;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const next = Math.min(MAX_INTEL, Math.max(MIN_INTEL, startW + delta));
      widthDragRef.current = next;
      setIntelWidth(next);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      localStorage.setItem(LS_WIDTH, String(widthDragRef.current));
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const gridTemplateColumns = collapsed ? "minmax(0, 1fr) 40px" : `minmax(0, 1fr) 6px ${intelWidth}px`;

  return (
    <div className="grid h-full min-h-0" style={{ gridTemplateColumns }}>
      <div className="min-h-0 min-w-0">{map}</div>

      {collapsed ? (
        <div className="flex h-full flex-col items-center border-l border-zinc-800 bg-zinc-950 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 shrink-0 px-0"
            onClick={() => setCollapsed(false)}
            aria-label="Show SITREP and thought trace panel"
            title="Show intel panel"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>
      ) : (
        <>
          <div
            aria-label="Resize intel panel"
            role="separator"
            className="cursor-col-resize bg-zinc-900 hover:bg-blue-500/30"
            onMouseDown={startResize}
          />
          <div className="flex min-h-0 min-w-0 flex-col border-l border-zinc-800 bg-zinc-950">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 px-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Intel</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                onClick={() => setCollapsed(true)}
                aria-label="Hide intel panel"
                title="Hide intel panel"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{intel}</div>
          </div>
        </>
      )}
    </div>
  );
}
