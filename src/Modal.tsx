import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

/** Native modal focus containment and Escape behavior, shared by account and LP entry. */
export function Modal({
  title,
  onClose,
  children,
  closeLabel,
  onBack,
  backLabel,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          onClose();
      }}
    >
      <div className="modal-header">
        {onBack && (
          <button
            className="icon-button"
            onClick={onBack}
            aria-label={backLabel}
          >
            <ArrowLeft size={21} />
          </button>
        )}
        <h2 id={titleId}>{title}</h2>
        <button
          autoFocus
          className="icon-button"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X size={22} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
