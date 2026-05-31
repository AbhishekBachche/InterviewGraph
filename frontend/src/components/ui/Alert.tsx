import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { cva } from "../../lib/variants";

export type AlertTone = "error" | "success" | "info";

const alertVariants = cva("he-alert", {
  variants: {
    tone: {
      error: "he-alert--error",
      success: "he-alert--success",
      info: "he-alert--info",
    },
  },
  defaultVariants: { tone: "info" },
});

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  tone: AlertTone;
  children: ReactNode;
  role?: "alert" | "status";
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { tone, children, role, className, ...props },
  ref
) {
  const r = role ?? (tone === "error" ? "alert" : "status");
  return (
    <div
      ref={ref}
      className={alertVariants({ tone, className })}
      role={r}
      data-slot="alert"
      data-tone={tone}
      {...props}
    >
      {children}
    </div>
  );
});

Alert.displayName = "Alert";

export type PageAlertsProps = {
  error?: string;
  success?: string;
  info?: string;
  className?: string;
};

export function PageAlerts({ error, success, info, className }: PageAlertsProps) {
  return (
    <div className={cn("he-page-alerts", className)} data-slot="page-alerts">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {success && !error ? <Alert tone="success">{success}</Alert> : null}
      {info && !error && !success ? <Alert tone="info">{info}</Alert> : null}
    </div>
  );
}
