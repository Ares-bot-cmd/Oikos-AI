"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { logoutAction, switchOrgAction } from "@/app/(auth)/actions";

export function UserMenu({
  name,
  email,
  roleLabel,
  orgs,
  currentOrgId,
}: {
  name: string;
  email: string;
  roleLabel: string;
  orgs: { id: string; name: string }[];
  currentOrgId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-ink/5"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-forest text-[12px] font-semibold text-ivory">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-36 truncate text-[13px] font-medium">{name}</span>
          <span className="block text-[11.5px] text-muted">{roleLabel}</span>
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && (
        <div role="menu" className="animate-fade-in absolute right-0 top-11 z-50 w-64 rounded-lg border border-line bg-surface p-1.5 shadow-pop">
          <div className="border-b border-line px-2.5 pb-2 pt-1">
            <div className="truncate text-[13px] font-medium">{name}</div>
            <div className="truncate text-xs text-muted">{email}</div>
          </div>
          {orgs.length > 1 && (
            <div className="border-b border-line py-1.5">
              <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Switch organization</div>
              {orgs.map((o) => (
                <form key={o.id} action={switchOrgAction}>
                  <input type="hidden" name="orgId" value={o.id} />
                  <button
                    role="menuitem"
                    disabled={o.id === currentOrgId}
                    className="w-full truncate rounded px-2.5 py-1.5 text-left text-[13px] hover:bg-ivory disabled:font-medium disabled:text-emerald"
                  >
                    {o.name}
                  </button>
                </form>
              ))}
            </div>
          )}
          <Link role="menuitem" href="/settings/security" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded px-2.5 py-1.5 text-[13px] hover:bg-ivory">
            <ShieldCheck className="size-4 text-muted" /> Security &amp; sessions
          </Link>
          <form action={logoutAction}>
            <button role="menuitem" className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[13px] text-danger hover:bg-danger-soft">
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
