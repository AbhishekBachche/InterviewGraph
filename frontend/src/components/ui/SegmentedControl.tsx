import { useCallback, useRef, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";

export type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean };

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
  /** Stretch to container width with equal-width segments (workflow steps). */
  fullWidth?: boolean;
};

/**
 * Accessible tablist-style control with arrow-key navigation (WAI-ARIA tabs pattern).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "md",
  fullWidth = false,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAt = useCallback((index: number) => {
    const el = refs.current[index];
    el?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const enabled = options.map((o, i) => (!o.disabled ? i : -1)).filter((i) => i >= 0);
      const currentIdx = options.findIndex((o) => o.value === value);
      const pos = enabled.indexOf(currentIdx);
      if (pos < 0) return;

      let nextPos = pos;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextPos = (pos + 1) % enabled.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextPos = (pos - 1 + enabled.length) % enabled.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        nextPos = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        nextPos = enabled.length - 1;
      } else {
        return;
      }

      const idx = enabled[nextPos];
      const opt = options[idx];
      if (opt && !opt.disabled) {
        onChange(opt.value);
        focusAt(idx);
      }
    },
    [focusAt, onChange, options, value]
  );

  return (
    <div
      className={cn(
        "inline-flex rounded-lg bg-muted p-1",
        fullWidth && "flex w-full",
        size === "sm" && "text-xs",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
      data-slot="segmented-control"
      onKeyDown={onKeyDown}
    >
      {options.map((opt, index) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            disabled={opt.disabled}
            className={cn(
              "rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              fullWidth && "flex-1 text-center",
              size === "sm" && "px-2 py-1.5 text-xs",
              selected && "bg-card text-heading shadow-sm ring-1 ring-border/80"
            )}
            data-value={opt.value}
            onClick={() => !opt.disabled && onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
