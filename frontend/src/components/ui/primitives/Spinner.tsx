import { forwardRef } from "react";
import { cn } from "../../../lib/cn";

export type SpinnerProps = {
  size?: "sm" | "md";
  label?: string;
  className?: string;
};

export const Spinner = forwardRef<SVGSVGElement, SpinnerProps>(function Spinner(
  { size = "md", label = "Loading", className },
  ref
) {
  return (
    <svg
      ref={ref}
      className={cn("he-spinner", size === "sm" && "he-spinner--sm", className)}
      viewBox="0 0 24 24"
      role="status"
      aria-label={label}
    >
      <circle className="he-spinner__track" cx="12" cy="12" r="10" fill="none" strokeWidth="3" />
      <circle className="he-spinner__arc" cx="12" cy="12" r="10" fill="none" strokeWidth="3" />
    </svg>
  );
});

Spinner.displayName = "Spinner";
