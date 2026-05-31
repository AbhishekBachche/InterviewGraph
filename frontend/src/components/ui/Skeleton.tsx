import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const ShadcnSkeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ShadcnSkeleton(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
});

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "text" | "block" | "circle";
  width?: string | number;
  height?: string | number;
};

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { variant = "block", width, height, className, style, ...props },
  ref
) {
  const mergedStyle = {
    ...style,
    ...(width != null ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height != null ? { height: typeof height === "number" ? `${height}px` : height } : {}),
  };
  return (
    <ShadcnSkeleton
      ref={ref}
      className={cn(
        variant === "text" && "h-3 rounded",
        variant === "circle" && "rounded-full",
        className
      )}
      data-slot="skeleton"
      aria-hidden="true"
      style={mergedStyle}
      {...props}
    />
  );
});

Skeleton.displayName = "Skeleton";

export type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  className?: string;
};

export function TableSkeleton({ rows = 5, columns = 4, className }: TableSkeletonProps) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden="true" data-slot="table-skeleton">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={`h-${i}`} variant="text" className="h-4" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`r-${r}`} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={`${r}-${c}`} variant="text" className="h-4" />
          ))}
        </div>
      ))}
    </div>
  );
}

export type MetricSkeletonProps = { count?: number; className?: string };

export function MetricSkeleton({ count = 5, className }: MetricSkeletonProps) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <Skeleton variant="text" width="40%" height={12} />
          <Skeleton variant="text" width="60%" height={28} />
        </div>
      ))}
    </div>
  );
}
