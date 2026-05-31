import { useId, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useControllableState } from "@/lib/hooks/useControllableState";
import { Badge } from "./badge";
import { Button } from "./Button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card";

export type StepTone = "primary" | "muted" | "result";

export type WorkflowCardProps = HTMLAttributes<HTMLDivElement> & {
  step: string;
  stepTone?: StepTone;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const stepBadgeVariant: Record<StepTone, "default" | "secondary" | "outline"> = {
  primary: "default",
  muted: "secondary",
  result: "outline",
};

export function WorkflowCard({
  step,
  stepTone = "primary",
  title,
  description,
  children,
  footer,
  collapsible = false,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  id: idProp,
  ...sectionProps
}: WorkflowCardProps) {
  const autoId = useId();
  const panelId = idProp ?? `workflow-${autoId}`;
  const [isOpen, setIsOpen] = useControllableState({
    value: collapsible ? open : true,
    defaultValue: collapsible ? defaultOpen : true,
    onChange: collapsible ? onOpenChange : undefined,
  });

  const bodyId = `${panelId}-body`;

  return (
    <Card
      className={cn("overflow-hidden border-border/80 shadow-sm", className)}
      data-slot="workflow-card"
      data-state={isOpen ? "open" : "closed"}
      {...sectionProps}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-border/60 bg-card pb-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Badge variant={stepBadgeVariant[stepTone]} className="font-semibold tracking-wide">
            {step}
          </Badge>
          <CardTitle className="text-base font-semibold leading-snug text-heading" id={`${panelId}-title`}>
            {title}
          </CardTitle>
          {description ? (
            <CardDescription
              className={cn(collapsible && !isOpen && "opacity-80")}
            >
              {description}
            </CardDescription>
          ) : null}
        </div>
        {collapsible ? (
          <Button
            variant="outline"
            size="sm"
            type="button"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <>
                <ChevronUp size={16} aria-hidden /> Hide
              </>
            ) : (
              <>
                <ChevronDown size={16} aria-hidden /> Open
              </>
            )}
          </Button>
        ) : null}
      </CardHeader>

      {isOpen && children ? (
        <CardContent
          className="space-y-4 pt-6"
          id={bodyId}
          role="region"
          aria-labelledby={`${panelId}-title`}
        >
          {children}
        </CardContent>
      ) : null}

      {isOpen && footer ? (
        <CardFooter className="border-t border-border/60 bg-muted/30">{footer}</CardFooter>
      ) : null}
    </Card>
  );
}

WorkflowCard.displayName = "WorkflowCard";
