import * as React from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[hsl(var(--primary-hover))]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:text-[hsl(var(--primary-hover))] hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const variantMap: Record<
  ButtonVariant,
  NonNullable<VariantProps<typeof buttonVariants>["variant"]>
> = {
  primary: "default",
  secondary: "secondary",
  outline: "outline",
  danger: "destructive",
  ghost: "ghost",
};

const sizeMap: Record<ButtonSize, NonNullable<VariantProps<typeof buttonVariants>["size"]>> = {
  sm: "sm",
  md: "default",
  lg: "lg",
};

type ShadcnButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    loadingText?: string;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
  };

const ShadcnButton = forwardRef<HTMLButtonElement, ShadcnButtonProps>(function ShadcnButton(
  {
    className,
    variant,
    size,
    asChild = false,
    loading,
    loadingText = "Please wait…",
    disabled,
    leftIcon,
    rightIcon,
    children,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled || loading;

  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : props.type ?? "button"}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={isDisabled}
      data-slot="button"
      data-variant={variant}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" aria-hidden />
          <span>{loadingText}</span>
        </>
      ) : (
        <>
          {leftIcon}
          {children}
          {rightIcon}
        </>
      )}
    </Comp>
  );
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: string;
  asChild?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingText,
    disabled,
    className,
    children,
    asChild = false,
    leftIcon,
    rightIcon,
    ...rest
  },
  ref
) {
  return (
    <ShadcnButton
      ref={ref}
      variant={variantMap[variant]}
      size={sizeMap[size]}
      loading={loading}
      loadingText={loadingText}
      disabled={disabled}
      className={className}
      asChild={asChild}
      leftIcon={leftIcon}
      rightIcon={rightIcon}
      {...rest}
    >
      {children}
    </ShadcnButton>
  );
});

Button.displayName = "Button";

export type ButtonLinkProps = Omit<LinkProps, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
};

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", size = "md", className, children, ...rest },
  ref
) {
  return (
    <Link
      ref={ref}
      className={cn(buttonVariants({ variant: variantMap[variant], size: sizeMap[size] }), className)}
      data-slot="button-link"
      data-variant={variant}
      {...rest}
    >
      {children}
    </Link>
  );
});

ButtonLink.displayName = "ButtonLink";

/** @deprecated Use ButtonLink with `to` — kept for Router-agnostic anchor usage */
export type ButtonAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  children: ReactNode;
};

export const ButtonAnchor = forwardRef<HTMLAnchorElement, ButtonAnchorProps>(function ButtonAnchor(
  { variant = "primary", size = "md", className, children, asChild = false, ...rest },
  ref
) {
  const cls = cn(buttonVariants({ variant: variantMap[variant], size: sizeMap[size] }), className);

  if (asChild) {
    return (
      <Slot className={cls} data-slot="button-link" data-variant={variant} {...rest}>
        {children as ReactElement}
      </Slot>
    );
  }

  return (
    <a ref={ref} className={cls} data-slot="button-link" data-variant={variant} {...rest}>
      {children}
    </a>
  );
});

ButtonAnchor.displayName = "ButtonAnchor";
