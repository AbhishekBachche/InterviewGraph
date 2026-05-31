import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Vertical page sections with consistent spacing (metrics → filters → content). */
export function PageStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("he-page-stack", className)} data-slot="page-stack">
      {children}
    </div>
  );
}
