"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ConfirmationOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
};

type ConfirmAction = (options: ConfirmationOptions) => Promise<boolean>;

const ConfirmationContext = createContext<ConfirmAction | null>(null);

export function useConfirmAction(): ConfirmAction {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error("useConfirmAction requires ConfirmationProvider");
  return confirm;
}

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ConfirmationOptions | null>(null);
  const resolver = useRef<((accepted: boolean) => void) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    return () => { resolver.current?.(false); resolver.current = null; };
  }, []);

  const finish = useCallback((accepted: boolean) => {
    resolver.current?.(accepted);
    resolver.current = null;
    setDialog(null);
    requestAnimationFrame(() => previousFocus.current?.focus());
  }, []);

  const confirm = useCallback<ConfirmAction>(options => {
    if (resolver.current) return Promise.resolve(false);
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialog(options);
    return new Promise<boolean>(resolve => { resolver.current = resolve; });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    confirmButton.current?.focus();
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [dialog, finish]);

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === confirmButton.current) {
      event.preventDefault(); cancelButton.current?.focus();
    } else if (!event.shiftKey && document.activeElement === cancelButton.current) {
      event.preventDefault(); confirmButton.current?.focus();
    }
  };

  return <ConfirmationContext.Provider value={confirm}>
    {children}
    {dialog && createPortal(
      <div className="motion-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" dir="rtl">
        <div className="motion-dialog app-confirm-dialog app-panel w-full max-w-md space-y-5 p-6 sm:p-7" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} onKeyDown={trapFocus}>
          <div className={`app-confirm-icon ${dialog.tone === "danger" ? "app-confirm-icon--danger" : ""}`} aria-hidden="true">
            <span className="material-symbols-outlined">{dialog.tone === "danger" ? "delete" : "priority_high"}</span>
          </div>
          <div className="space-y-2">
            <h2 id={titleId} className="text-xl font-bold">{dialog.title}</h2>
            <p id={messageId} className="app-muted whitespace-pre-line text-sm leading-7">{dialog.message}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button ref={cancelButton} type="button" className="app-secondary-button flex-1" onClick={() => finish(false)}>إلغاء</button>
            <button ref={confirmButton} type="button" className={`app-primary-button flex-1 ${dialog.tone === "danger" ? "app-confirm-danger-button" : ""}`} onClick={() => finish(true)}>{dialog.confirmLabel}</button>
          </div>
        </div>
      </div>,
      document.body,
    )}
  </ConfirmationContext.Provider>;
}
