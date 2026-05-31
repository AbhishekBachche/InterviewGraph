import * as React from "react";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const ShadcnCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-xl border border-border/80 bg-card text-card-foreground shadow-[0_4px_12px_rgba(15,23,42,0.07),0_1px_3px_rgba(15,23,42,0.05)]", className)}
      {...props}
    />
  )
);
ShadcnCard.displayName = "Card";

const ShadcnCardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
ShadcnCardHeader.displayName = "CardHeader";

const ShadcnCardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-display text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
);
ShadcnCardTitle.displayName = "CardTitle";

const ShadcnCardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
ShadcnCardDescription.displayName = "CardDescription";

const ShadcnCardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
);
ShadcnCardContent.displayName = "CardContent";

const ShadcnCardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  )
);
ShadcnCardFooter.displayName = "CardFooter";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  variant?: "default" | "workflow";
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant = "default", children, ...props },
  ref
) {
  return (
    <ShadcnCard
      ref={ref}
      className={cn(
        variant === "workflow" && "border-accent/25 bg-gradient-to-br from-card to-accent/40",
        className
      )}
      data-slot="card"
      {...props}
    >
      {children}
    </ShadcnCard>
  );
});

Card.displayName = "Card";

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref
) {
  return <ShadcnCardHeader ref={ref} className={cn("pb-4", className)} data-slot="card-header" {...props} />;
});

CardHeader.displayName = "CardHeader";

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function CardTitle(
  { className, ...props },
  ref
) {
  return (
    <ShadcnCardTitle ref={ref} className={cn("text-base font-semibold", className)} data-slot="card-title" {...props} />
  );
});

CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return (
      <ShadcnCardDescription ref={ref} className={className} data-slot="card-description" {...props} />
    );
  }
);

CardDescription.displayName = "CardDescription";

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref
) {
  return <ShadcnCardContent ref={ref} className={className} data-slot="card-content" {...props} />;
});

CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...props },
  ref
) {
  return <ShadcnCardFooter ref={ref} className={cn("pt-0", className)} data-slot="card-footer" {...props} />;
});

CardFooter.displayName = "CardFooter";
