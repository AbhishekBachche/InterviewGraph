import type { ReactNode } from "react";
import { Badge, type BadgeProps } from "./badge";
import { cn } from "@/lib/utils";

export type StatusBadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const toneVariant: Record<StatusBadgeTone, NonNullable<BadgeProps["variant"]>> = {
  neutral: "muted",
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "secondary",
  primary: "default",
};

export type StatusBadgeProps = {
  children: ReactNode;
  tone?: StatusBadgeTone;
  className?: string;
};

export function StatusBadge({ children, tone = "neutral", className }: StatusBadgeProps) {
  return (
    <Badge variant={toneVariant[tone]} className={cn("font-medium", className)} data-slot="status-badge">
      {children}
    </Badge>
  );
}

export function statusToneFromLabel(status?: string | null): StatusBadgeTone {
  const s = (status || "").toLowerCase();
  if (s.includes("pass") || s.includes("strong") || s.includes("hire")) return "success";
  if (s.includes("fail") || s.includes("reject") || s.includes("no")) return "danger";
  if (s.includes("border") || s.includes("review") || s.includes("pending")) return "warning";
  if (s.includes("active") || s.includes("online")) return "primary";
  return "neutral";
}
