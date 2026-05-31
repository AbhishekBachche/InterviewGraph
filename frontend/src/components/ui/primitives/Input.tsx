import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../../../lib/cn";
import { cva } from "../../../lib/variants";

const inputVariants = cva("he-input", {
  variants: {
    intent: {
      default: "",
      error: "he-input--error",
    },
  },
  defaultVariants: { intent: "default" },
});

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  intent?: "default" | "error";
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, intent = "default", type = "text", ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      className={inputVariants({ intent, className })}
      data-slot="input"
      {...props}
    />
  );
});

Input.displayName = "Input";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  intent?: "default" | "error";
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, intent = "default", ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      className={cn(inputVariants({ intent }), "he-textarea", className)}
      data-slot="textarea"
      {...props}
    />
  );
});

Textarea.displayName = "Textarea";

export type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
  { className, ...props },
  ref
) {
  return (
    <select ref={ref} className={cn("he-input", "he-select", className)} data-slot="select" {...props} />
  );
});

NativeSelect.displayName = "NativeSelect";
