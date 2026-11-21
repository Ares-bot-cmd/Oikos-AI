"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastItem = { id: number; message: string; tone: "success" | "error" };
const EVENT = "oikos:toast";
export const FLASH_COOKIE = "oikos_flash";

export function toast(message: string, tone: ToastItem["tone"] = "success") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

function readFlash(): ToastItem | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(FLASH_COOKIE + "="));
  if (!match) return null;
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
  try {
    const { m, t } = JSON.parse(decodeURIComponent(match.split("=").slice(1).join("=")));
    return { id: Date.now(), message: String(m).slice(0, 300), tone: t === "error" ? "error" : "success" };
  } catch {
    return null;
  }
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const onToast = (e: Event) => {
      const { message, tone } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-2), { id, message, tone }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  useEffect(() => {
    const f = readFlash();
    if (f) toast(f.message, f.tone);
  }, [pathname, search]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "animate-fade-in pointer-events-auto flex max-w-sm items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-[13.5px] shadow-pop",
            t.tone === "success" ? "border-positive/25" : "border-danger/30",
          )}
        >
          {t.tone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-positive" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
          <span className="text-ink">{t.message}</span>
          <button aria-label="Dismiss" className="ml-1 text-muted hover:text-ink" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
