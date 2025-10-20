import { useEffect, useRef, useId } from 'react';
import './ConfirmModal.css';

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  open,
  title = 'Confirm',
  message = 'Are you sure?',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const firstBtnRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && firstBtnRef.current) {
      firstBtnRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Tab') {
        // simple focus trap: keep focus inside modal
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  const headingId = useId();
  if (!open) return null;

  return (
    <div className="modal-overlay" aria-hidden={false}>
      <button
        type="button"
        aria-label="Dismiss dialog"
        className="modal-backdrop-btn"
        onClick={onCancel}
      />
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        ref={modalRef}>
        <h4 id={headingId} className="modal-title">
          {title}
        </h4>
        <div className="modal-message">{message}</div>
        <div className="modal-actions">
          <button
            ref={firstBtnRef}
            type="button"
            className="btn cancel"
            onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={'btn confirm' + (destructive ? ' destructive' : '')}
            onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
