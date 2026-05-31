import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button, ButtonLink } from "./Button";

export type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  actionLink?: { label: string; to: string };
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
  compact?: boolean;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionLink,
  secondaryAction,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn("he-empty-state", compact && "he-empty-state--compact", className)}
      data-slot="empty-state"
      role="status"
    >
      {Icon ? (
        <div className="he-empty-state__icon" aria-hidden>
          <Icon size={compact ? 28 : 36} strokeWidth={1.5} />
        </div>
      ) : null}
      <h3 className="he-empty-state__title">{title}</h3>
      {description ? <p className="he-empty-state__desc">{description}</p> : null}
      {(action || actionLink || secondaryAction) && (
        <div className="he-empty-state__actions">
          {actionLink ? (
            <ButtonLink to={actionLink.to} variant="primary" size="sm">
              {actionLink.label}
            </ButtonLink>
          ) : action ? (
            <Button type="button" variant="primary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button type="button" variant="outline" size="sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
