"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A value that can only be computed in the browser (local time zone, today's date).
 * Renders `fallback` on the server and during hydration, then the client value — without
 * hydration mismatches or setState-in-effect.
 */
export function useClientValue<T extends string | number | boolean>(compute: () => T, fallback: T): T {
  return useSyncExternalStore(noop, compute, () => fallback);
}

export const todayISO = () => new Date().toLocaleDateString("en-CA");

export function localDateTimeInput(offsetHours: number) {
  const d = new Date(Date.now() + offsetHours * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
