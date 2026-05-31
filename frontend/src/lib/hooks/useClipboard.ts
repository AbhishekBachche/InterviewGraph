import { useCallback, useState } from "react";

export function useClipboard() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      setCopied(false);
      return false;
    }
  }, []);

  return { copy, copied };
}
