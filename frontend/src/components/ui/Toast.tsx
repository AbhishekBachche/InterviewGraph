import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";

export type ToastTone = "success" | "error" | "info";

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

function nextId() {
  toastId += 1;
  return `toast-${toastId}`;
}

const toneIcon: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

function ToastViewport({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: string) => void }) {
  if (items.length === 0) return null;
  return createPortal(
    <div className="he-toast-viewport" aria-live="polite" aria-relevant="additions" data-slot="toast-viewport">
      {items.map((t) => {
        const Icon = toneIcon[t.tone];
        return (
          <div key={t.id} className={cn("he-toast", `he-toast--${t.tone}`)} role="status">
            <Icon className="he-toast__icon" size={18} aria-hidden />
            <span className="he-toast__message">{t.message}</span>
            <button
              type="button"
              className="he-toast__dismiss"
              aria-label="Dismiss"
              onClick={() => onDismiss(t.id)}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId();
    setItems((prev) => [...prev.slice(-4), { id, message, tone }]);
    window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 4000);
  }, [dismiss]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
      info: (m) => push(m, "info"),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
