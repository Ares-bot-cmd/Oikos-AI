import Link from "next/link";
import { cn } from "@/lib/utils";

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number; tone?: "danger" }[]; active: string }) {
  return (
    <nav aria-label="Views" className="flex gap-1 overflow-x-auto border-b border-line px-3">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[13.5px]",
            active === t.key ? "border-emerald font-medium text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count != null && (
            <span className={cn("tnum rounded px-1.5 text-[11px]", t.tone === "danger" && t.count > 0 ? "bg-danger-soft text-danger" : "bg-ink/[0.06] text-ink-2")}>{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
