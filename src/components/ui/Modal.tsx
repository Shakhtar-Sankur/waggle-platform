import { X } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useT } from "../../i18n";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}

export function Modal({ open, title, description, children, onClose }: ModalProps) {
  const t = useT();
  // Lock background scroll while a modal is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  // Rendered into <body> via a portal so the fixed, centered overlay is always
  // positioned relative to the viewport — never trapped inside a transformed
  // (animated) parent, which would otherwise require scrolling to reach it.
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("a11y_close")}>
            <X size={18} />
          </Button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
