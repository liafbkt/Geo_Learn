import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './shell.css';

type Props = Readonly<{
  labelledBy: string;
  className: string;
  children: ReactNode;
  onEscape?: () => void;
}>;

const focusableSelector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function ModalDialog({ labelledBy, className, children, onEscape }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      previousFocus?.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector)];
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="app-overlay"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onEscape?.();
      }}
      onKeyDown={trapFocus}
    >
      <section className={className}>{children}</section>
    </dialog>
  );
}
