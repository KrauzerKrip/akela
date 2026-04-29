import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300",
        className
      )}
    >
      {children}
    </span>
  );
}
