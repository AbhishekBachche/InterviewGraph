import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "xl";
  className?: string;
  /** id for aria-labelledby */
  titleId?: string;
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
  className,
  titleId: titleIdProp,
}: ModalProps) {
  const autoId = useId();
  const titleId = titleIdProp ?? `modal-title-${autoId.replace(/:/g, "")}`;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="he-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={cn("he-modal-panel", `he-modal-panel--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-slot="modal"
      >
        <div className="he-modal-panel__head">
          <div className="he-modal-panel__titles">
            <h2 id={titleId} className="he-modal-panel__title">
              {title}
            </h2>
            {subtitle ? <p className="he-modal-panel__subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="he-modal-close" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="he-modal-panel__body">{children}</div>
        {footer ? <div className="he-modal-panel__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <div className="he-modal-actions">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === "danger" ? "danger" : "primary"}
            size="sm"
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {description ? <p className="he-modal-confirm-desc">{description}</p> : null}
    </Modal>
  );
}
