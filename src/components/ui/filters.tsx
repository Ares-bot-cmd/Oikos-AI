"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { RANGE_OPTIONS } from "@/lib/list-params";

/** Updates URL search params; the server component re-renders with the new filters. */
export function useParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (updates: Record<string, string | undefined>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) u.set(k, v);
      else u.delete(k);
    }
    u.delete("page");
    start(() => router.replace(`${pathname}${u.size ? "?" + u.toString() : ""}`, { scroll: false }));
  };
  return { set, pending, sp };
}

export function SearchBox({ placeholder = "Search…", className }: { placeholder?: string; className?: string }) {
  const { set, pending, sp } = useParamUpdater();
  const [value, setValue] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        aria-label={placeholder}
        value={value}
        maxLength={100}
        placeholder={placeholder}
        onChange={(e) => {
          setValue(e.target.value);
          clearTimeout(timer.current);
          const v = e.target.value;
          timer.current = setTimeout(() => set({ q: v.trim() || undefined }), 300);
        }}
        className="h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-sm placeholder:text-muted/70 focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/15"
      />
      {pending && <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" />}
    </div>
  );
}

export function FilterSelect({
  name,
  label,
  options,
  className,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const { set, sp } = useParamUpdater();
  return (
    <select
      aria-label={label}
      value={sp.get(name) ?? ""}
      onChange={(e) => set({ [name]: e.target.value || undefined })}
      className={cn(
        "h-9 rounded-md border border-line-strong bg-surface px-2.5 pr-8 text-sm text-ink focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/15",
        className,
      )}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateRangeFilter({ fallback = "30d" }: { fallback?: string }) {
  const { set, sp } = useParamUpdater();
  const range = sp.get("range") ?? fallback;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Date range"
        value={range}
        onChange={(e) => set({ range: e.target.value === fallback ? undefined : e.target.value, from: undefined, to: undefined })}
        className="h-9 rounded-md border border-line-strong bg-surface px-2.5 pr-8 text-sm focus:border-emerald focus:outline-none"
      >
        {RANGE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      {range === "custom" && (
        <>
          <input
            type="date"
            aria-label="From date"
            defaultValue={sp.get("from") ?? ""}
            onChange={(e) => set({ range: "custom", from: e.target.value || undefined })}
            className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"
          />
          <span className="text-muted">–</span>
          <input
            type="date"
            aria-label="To date"
            defaultValue={sp.get("to") ?? ""}
            onChange={(e) => set({ range: "custom", to: e.target.value || undefined })}
            className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm"
          />
        </>
      )}
    </div>
  );
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2 border-b border-line px-4 py-3", className)}>{children}</div>;
}
