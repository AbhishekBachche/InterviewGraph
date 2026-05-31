import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type FilterToolbarProps = {
  children: ReactNode;
  /** Section label (uppercase styling applied in CSS). */
  label?: string;
  /** `grid` — multi-column filters (Data Hub). `bar` — search + trailing actions. */
  variant?: "grid" | "bar";
  /** Trailing actions (e.g. Refresh) for `bar` variant. */
  actions?: ReactNode;
  className?: string;
};

export function FilterToolbar({
  children,
  label = "Filters",
  variant = "grid",
  actions,
  className,
}: FilterToolbarProps) {
  return (
    <section
      className={cn("he-filter-toolbar", variant === "bar" && "he-filter-toolbar--bar", className)}
      data-slot="filter-toolbar"
      aria-label={label}
    >
      <span className="he-filter-toolbar__label">{label}</span>
      <div
        className={cn(
          "he-filter-toolbar__grid",
          variant === "bar" && "he-filter-toolbar__grid--bar"
        )}
      >
        {children}
        {actions ? <div className="he-filter-toolbar__actions">{actions}</div> : null}
      </div>
    </section>
  );
}
