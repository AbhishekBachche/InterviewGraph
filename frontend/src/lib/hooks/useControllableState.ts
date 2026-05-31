import { useCallback, useState } from "react";

/**
 * Controlled / uncontrolled state (React 19-style pattern, React 18 compatible).
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value?: T;
  defaultValue: T;
  onChange?: (next: T) => void;
}): readonly [T, (next: T) => void] {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const isControlled = value !== undefined;
  const state = isControlled ? value : uncontrolled;

  const setState = useCallback(
    (next: T) => {
      if (!isControlled) setUncontrolled(next);
      onChange?.(next);
    },
    [isControlled, onChange]
  );

  return [state, setState] as const;
}
