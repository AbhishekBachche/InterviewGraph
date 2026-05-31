import { useCallback, useRef, useState } from "react";
import { formatUserError } from "../../api";

export type UseAsyncActionOptions = {
  onSuccess?: (message?: string) => void;
  onError?: (message: string) => void;
};

export function useAsyncAction(opts?: UseAsyncActionOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const run = useCallback(async <T,>(fn: () => Promise<T>, successMessage?: string): Promise<T | null> => {
    setError("");
    setBusy(true);
    try {
      const result = await fn();
      if (successMessage) optsRef.current?.onSuccess?.(successMessage);
      else optsRef.current?.onSuccess?.();
      return result;
    } catch (e) {
      const msg = formatUserError(e);
      setError(msg);
      optsRef.current?.onError?.(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(""), []);

  return { busy, error, setError, clearError, run };
}
