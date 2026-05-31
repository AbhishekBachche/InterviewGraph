import {
  Children,
  cloneElement,
  isValidElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "../../../lib/cn";

type SlotProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode;
};

/**
 * Polymorphic merge: pass props/className to the single child element (Radix Slot pattern).
 */
export function Slot({ children, className, ...props }: SlotProps) {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;

  const childProps = child.props as HTMLAttributes<HTMLElement> & Record<string, unknown>;
  return cloneElement(child as ReactElement<HTMLAttributes<HTMLElement>>, {
    ...childProps,
    ...props,
    className: cn(className, childProps.className),
  });
}
