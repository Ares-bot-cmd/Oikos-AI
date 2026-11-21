export type SearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 25;

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== "" ? s.trim().slice(0, 200) : undefined;
}

export function listParams<S extends string>(sp: SearchParams, sortable: readonly S[], defaultSort: S, defaultDir: "asc" | "desc" = "desc") {
  const sortRaw = param(sp, "sort");
  const sort = (sortable as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as S) : defaultSort;
  const dir: "asc" | "desc" = param(sp, "dir") === "asc" ? "asc" : param(sp, "dir") === "desc" ? "desc" : defaultDir;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(param(sp, "page") ?? "1", 10) || 1));
  return { q: param(sp, "q"), sort, dir, page, offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE };
}

/** Builds a URL that keeps current params, applying overrides (undefined removes a key). */
export function hrefWith(pathname: string, sp: SearchParams, overrides: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) u.set(k, s);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === "") u.delete(k);
    else u.set(k, String(v));
  }
  const qs = u.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export type DateRange = { from: Date; to: Date; label: string; key: string };

export const RANGE_OPTIONS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "Month to date" },
  { key: "qtd", label: "Quarter to date" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "Last 12 months" },
  { key: "custom", label: "Custom range" },
] as const;

/** Resolves ?range= (and ?from/&to= for custom) into a [from, to) window plus the comparison window. */
export function dateRange(sp: SearchParams, fallback = "30d"): { current: DateRange; previous: DateRange } {
  const key = param(sp, "range") ?? fallback;
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let from: Date;
  let to = endOfToday;
  switch (key) {
    case "7d": from = new Date(to.getTime() - 7 * 86400_000); break;
    case "90d": from = new Date(to.getTime() - 90 * 86400_000); break;
    case "mtd": from = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case "qtd": from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1); break;
    case "ytd": from = new Date(now.getFullYear(), 0, 1); break;
    case "12m": from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1); break;
    case "custom": {
      const f = param(sp, "from");
      const t = param(sp, "to");
      const fd = f ? new Date(f + "T00:00:00") : null;
      const td = t ? new Date(t + "T00:00:00") : null;
      from = fd && !Number.isNaN(fd.getTime()) ? fd : new Date(to.getTime() - 30 * 86400_000);
      to = td && !Number.isNaN(td.getTime()) ? new Date(td.getTime() + 86400_000) : endOfToday;
      if (to <= from) to = new Date(from.getTime() + 86400_000);
      break;
    }
    default: from = new Date(to.getTime() - 30 * 86400_000);
  }
  const span = to.getTime() - from.getTime();
  const label = RANGE_OPTIONS.find((o) => o.key === key)?.label ?? "Last 30 days";
  return {
    current: { from, to, label, key },
    previous: { from: new Date(from.getTime() - span), to: from, label: "Previous period", key: "prev" },
  };
}
