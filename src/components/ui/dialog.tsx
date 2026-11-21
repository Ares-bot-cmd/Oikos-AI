"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const DialogCtx = createContext<{ close: () => void } | null>(null);
export const useDialog = () => useContext(DialogCtx);

export function Dialog({
  trigger,
  title,
  description,
  children,
  wide,
}: {
  trigger: (open: () => void) => React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Sync React state to the native <dialog> (focus trap, Esc, backdrop are native).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (isOpen && !el.open) el.showModal();
    if (!isOpen && el.open) el.close();
  }, [isOpen]);

  return (
    <>
      {trigger(open)}
      <dialog
        ref={ref}
        aria-label={title}
        onClose={close}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className={cn(
          "m-auto max-h-[90vh] w-[calc(100%-32px)] overflow-visible rounded-xl border border-line bg-surface p-0 text-ink shadow-pop",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
            </div>
            <button type="button" onClick={close} aria-label="Close" className="rounded p-1 text-muted hover:bg-ink/5 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            <DialogCtx.Provider value={{ close }}>{children}</DialogCtx.Provider>
          </div>
        </div>
      </dialog>
    </>
  );
}
