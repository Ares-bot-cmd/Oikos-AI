"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function SettingsNav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={pathname === i.href ? "page" : undefined} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13.5px]", pathname === i.href ? "border-emerald font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
