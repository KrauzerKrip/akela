import { useState, type MouseEvent as ReactMouseEvent, type ReactNode, type JSX } from "react";
import { cn } from "../../lib/utils";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  initialLeftWidth?: number;
  className?: string;
}

export function ResizablePanels({
  left,
  right,
  initialLeftWidth = 280,
  className,
}: ResizablePanelsProps): JSX.Element {
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);

  const startResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const onMove = (moveEvent: MouseEvent) => {
      setLeftWidth(Math.min(420, Math.max(220, moveEvent.clientX)));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className={cn("grid h-full min-h-0", className)} style={{ gridTemplateColumns: `${leftWidth}px 6px 1fr` }}>
      <div className="min-h-0 border-r border-zinc-800">{left}</div>
      <div
        aria-label="Resize panels"
        role="separator"
        className="cursor-col-resize bg-zinc-900 hover:bg-blue-500/30"
        onMouseDown={startResize}
      />
      <div className="min-h-0">{right}</div>
    </div>
  );
}
