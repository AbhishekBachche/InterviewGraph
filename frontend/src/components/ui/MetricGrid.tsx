import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type MetricGridProps = {
  items: { label: string; value: ReactNode }[];
  /** Fixed column count; omit for responsive auto-fit. */
  columns?: 2 | 3 | 4 | 5;
  className?: string;
};

export function MetricGrid({ items, columns, className }: MetricGridProps) {
  return (
    <div
      className={cn("he-metric-grid", columns && `he-metric-grid--cols-${columns}`, className)}
      data-slot="metric-grid"
    >
      {items.map((item) => (
        <div key={item.label} className="he-metric-card">
          <span className="he-metric-card__label">{item.label}</span>
          <span className="he-metric-card__value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
