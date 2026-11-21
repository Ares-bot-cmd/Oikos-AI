"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, Building, Building2, Columns3, Contact, CreditCard, FileBarChart, FileSignature, LayoutDashboard, LayoutGrid,
  MapPin, Megaphone, Menu, MessageCircle, PhoneCall, Plug, ShieldCheck, Sparkles, TrendingUp, Trophy, UserCog, Users,
  Wallet, Workflow, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import type { NavSection } from "./nav";

const ICONS = {
  Bell, Building, Building2, Columns3, Contact, CreditCard, FileBarChart, FileSignature, LayoutDashboard, LayoutGrid,
  MapPin, Megaphone, MessageCircle, PhoneCall, Plug, ShieldCheck, Sparkles, TrendingUp, Trophy, UserCog, Users, Wallet, Workflow,
} as const;

function NavList({ sections, onNavigate, badges }: { sections: NavSection[]; onNavigate?: () => void; badges: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-6">
      {sections.map((section) => (
        <div key={section.title} className="mt-5 first:mt-2">
          <div className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sage/80">{section.title}</div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const badge = badges[item.href];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-md px-2 py-[7px] text-[13.5px] transition-colors",
                      active ? "bg-ivory/[0.09] font-medium text-white" : "text-ivory/70 hover:bg-ivory/[0.05] hover:text-ivory",
                    )}
                  >
                    <Icon className={cn("size-[17px] shrink-0", active ? "text-champagne" : "text-sage group-hover:text-ivory/90")} />
                    <span className="truncate">{item.label}</span>
                    {badge ? (
                      <span className="tnum ml-auto rounded bg-champagne/90 px-1.5 text-[11px] font-semibold text-forest">{badge > 99 ? "99+" : badge}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ sections, orgName, badges }: { sections: NavSection[]; orgName: string; badges: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const inner = (onNavigate?: () => void) => (
    <>
      <div className="flex h-14 shrink-0 items-center px-5">
        <Link href="/dashboard" onClick={onNavigate} aria-label="Oikos AI dashboard">
          <Logo light />
        </Link>
      </div>
      <div className="mx-5 mb-1 truncate rounded-md border border-ivory/10 px-2.5 py-1.5 text-[12px] text-ivory/70" title={orgName}>
        {orgName}
      </div>
      <NavList sections={sections} onNavigate={onNavigate} badges={badges} />
    </>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-forest lg:flex">{inner()}</aside>

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="fixed left-3 top-2.5 z-40 inline-flex size-9 items-center justify-center rounded-md text-ink hover:bg-ink/5 lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-forest/40" onClick={() => setOpen(false)} />
          <aside className="animate-fade-in absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-forest shadow-pop">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-md text-ivory/70 hover:bg-ivory/10"
            >
              <X className="size-4" />
            </button>
            {inner(() => setOpen(false))}
          </aside>
        </div>
      )}
    </>
  );
}
