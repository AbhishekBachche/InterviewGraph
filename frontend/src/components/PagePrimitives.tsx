import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
};

type InlineStatusProps = {
  tone: "loading" | "ok" | "err";
  children: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-2xl font-bold tracking-tight text-heading sm:text-3xl">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function InlineStatus({ tone, children, className }: InlineStatusProps) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm",
        tone === "loading" && "bg-muted text-muted-foreground",
        tone === "ok" && "bg-success/10 text-success",
        tone === "err" && "bg-destructive/10 text-destructive",
        className
      )}
      role={tone === "err" ? "alert" : "status"}
      aria-live="polite"
    >
      {tone === "loading" ? (
        <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
      ) : null}
      {children}
    </p>
  );
}

type SectionCardProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function SectionCard({ title, subtitle, actions, className, children }: SectionCardProps) {
  return (
    <Card className={className}>
      {(title || subtitle || actions) && (
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
          <div className="space-y-1">
            {title ? <CardTitle className="text-base">{title}</CardTitle> : null}
            {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </CardHeader>
      )}
      <CardContent className={title || subtitle || actions ? "pt-0" : undefined}>{children}</CardContent>
    </Card>
  );
}
