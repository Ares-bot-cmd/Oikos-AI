import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/** Digits-only phone key used for duplicate detection; Indian 10-digit numbers get a 91 prefix. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function formatMoney(value: number | null | undefined, currency = "INR", compact = false): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (compact && currency === "INR") {
    const abs = Math.abs(value);
    if (abs >= 1e7) return `₹${(value / 1e7).toFixed(abs >= 1e9 ? 0 : 2)} Cr`;
    if (abs >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
  }
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    minimumFractionDigits: 0,
    notation: compact && currency !== "INR" ? "compact" : "standard",
  }).format(value);
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(value: Date | string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? value + "T00:00:00" : value) : value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: typeof value === "string" && value.length === 10 ? undefined : tz,
  }).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, tz = "Asia/Kolkata"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

export function relativeTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86400_000) return rtf.format(Math.round(diff / 3600_000), "hour");
  if (abs < 30 * 86400_000) return rtf.format(Math.round(diff / 86400_000), "day");
  return formatDate(d);
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** YYYY-MM-DD in local time. */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function safeDivide(a: number, b: number): number | null {
  return b ? a / b : null;
}

/** Escapes a value for CSV (and neutralises spreadsheet formula injection). */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
