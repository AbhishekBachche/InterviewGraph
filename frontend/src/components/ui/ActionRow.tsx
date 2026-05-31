import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ActionRowProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  align?: "start" | "center" | "end" | "between";
};

export const ActionRow = forwardRef<HTMLDivElement, ActionRowProps>(function ActionRow(
  { children, className, align = "start", ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn("he-action-row", align !== "start" && `he-action-row--${align}`, className)}
      data-slot="action-row"
      {...props}
    >
      {children}
    </div>
  );
});

ActionRow.displayName = "ActionRow";
