"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useSubmit } from "@/lib/use-submit";
import { ArrowDown, ArrowUp, Copy } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { cn, formatMoney, relativeTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { assignLeadsAction } from "./actions";

const STAGE: Record<string, { label: string; tone: "info" | "neutral" | "brand" | "gold" | "warning" | "positive" | "danger" }> = {
  new: { label: "New", tone: "info" }, contacted: { label: "Contacted", tone: "neutral" }, qualified: { label: "Qualified", tone: "brand" },
  follow_up: { label: "Follow-up", tone: "neutral" }, site_visit_scheduled: { label: "Visit scheduled", tone: "gold" },
  negotiation: { label: "Negotiation", tone: "warning" }, booked: { label: "Booked", tone: "positive" }, lost: { label: "Lost", tone: "danger" },
};

export type LeadRow = {
  id: string; name: string; phone: string | null; email: string | null; stage: string; score: number | null; intent: "hot" | "warm" | "cold" | null;
  budgetMin: number | null; budgetMax: number | null; createdAt: string; lastContactedAt: string | null; ownerName: string | null;
  projectName: string | null; priority: string; duplicateOfId: string | null; nextAction: string | null; source: string;
};

export function LeadsTable({
  rows, members, canAssign, currency, sort, dir, sortLinks,
}: {
  rows: LeadRow[]; members: { value: string; label: string }[]; canAssign: boolean; currency: string; sort: string; dir: "asc" | "desc"; sortLinks: Record<string, string>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action] = useActionState<ActionState, FormData>(assignLeadsAction, null);
  const { onSubmit: submitAssign } = useSubmit(action);
  const last = useRef<ActionState>(null);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) toast(state.message ?? "Done");
    else if (state.error) toast(state.error, "error");
  }, [state]);

  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const budget = (r: LeadRow) =>
    r.budgetMax == null && r.budgetMin == null ? "—" : r.budgetMin != null && r.budgetMax != null ? `${formatMoney(r.budgetMin, currency, true)}–${formatMoney(r.budgetMax, currency, true)}` : formatMoney(r.budgetMax ?? r.budgetMin, currency, true);

  return (
    <div>
      {canAssign && selected.size > 0 && (
        <form onSubmit={(e) => { submitAssign(e); setSelected(new Set()); }} className="flex flex-wrap items-center gap-2 border-b border-line bg-emerald-soft/50 px-4 py-2.5 text-[13px]">
          {[...selected].map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
          <span className="font-medium">{selected.size} selected</span>
          <Select name="ownerId" aria-label="Assign to" className="h-8 w-56" defaultValue="" required>
            <option value="" disabled>Assign to…</option>
            {members.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            <option value="unassign">— Unassign</option>
          </Select>
          <SubmitButton size="sm">Apply</SubmitButton>
          <button type="button" className="ml-auto text-muted hover:text-ink" onClick={() => setSelected(new Set())}>Clear selection</button>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-[13.5px]">
          <thead className="border-b border-line bg-ivory/60 text-xs text-muted">
            <tr>
              {canAssign && (
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" aria-label="Select all on this page" className="size-4 accent-emerald" checked={all} onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              )}
              <SortLink field="name" sort={sort} dir={dir} href={sortLinks["name"]}>Lead</SortLink>
              <SortLink field="stage" sort={sort} dir={dir} href={sortLinks["stage"]}>Stage</SortLink>
              <SortLink field="score" sort={sort} dir={dir} href={sortLinks["score"]}>AI score</SortLink>
              <SortLink field="budget" sort={sort} dir={dir} href={sortLinks["budget"]}>Budget</SortLink>
              <th className="px-3 py-2.5 font-medium">Project</th>
              <th className="px-3 py-2.5 font-medium">Owner</th>
              <SortLink field="lastContact" sort={sort} dir={dir} href={sortLinks["lastContact"]}>Last contact</SortLink>
              <SortLink field="created" sort={sort} dir={dir} href={sortLinks["created"]}>Created</SortLink>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-line last:border-0 hover:bg-ivory/50", selected.has(r.id) && "bg-emerald-soft/30")}>
                {canAssign && (
                  <td className="px-3 py-2.5">
                    <input type="checkbox" aria-label={`Select ${r.name}`} className="size-4 accent-emerald" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td className="max-w-[260px] px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/leads/${r.id}`} className="truncate font-medium text-ink hover:underline">{r.name}</Link>
                    {r.duplicateOfId && <span title="Possible duplicate"><Copy className="size-3.5 text-warning" /></span>}
                    {r.priority === "urgent" && <Badge tone="danger">Urgent</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">{r.phone ?? r.email ?? "—"}</div>
                </td>
                <td className="px-3 py-2.5"><Badge tone={STAGE[r.stage]?.tone ?? "neutral"}>{STAGE[r.stage]?.label ?? r.stage}</Badge></td>
                <td className="px-3 py-2.5" title={r.nextAction ?? undefined}>
                  {r.intent ? (
                    <Badge tone={r.intent === "hot" ? "danger" : r.intent === "warm" ? "warning" : "info"}>
                      {r.intent[0].toUpperCase() + r.intent.slice(1)} <span className="tnum opacity-80">· {r.score}</span>
                    </Badge>
                  ) : "—"}
                </td>
                <td className="tnum whitespace-nowrap px-3 py-2.5">{budget(r)}</td>
                <td className="max-w-[160px] truncate px-3 py-2.5 text-ink-2">{r.projectName ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{r.ownerName ?? <span className="text-warning">Unassigned</span>}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{r.lastContactedAt ? relativeTime(r.lastContactedAt) : <span className="text-danger">Never</span>}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{relativeTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortLink({ field, children, sort, dir, href }: { field: string; children: React.ReactNode; sort: string; dir: "asc" | "desc"; href: string }) {
  return (
    <th scope="col" className="whitespace-nowrap px-3 py-2.5 font-medium" aria-sort={sort === field ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} className={cn("inline-flex items-center gap-1 hover:text-ink", sort === field && "text-ink")}>
        {children}
        {sort === field && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    </th>
  );
}
