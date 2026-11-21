"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { cn, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { changeStageAction } from "../leads/actions";

export type Card = {
  id: string; name: string; score: number | null; intent: "hot" | "warm" | "cold" | null; budgetMax: number | null;
  owner: string | null; project: string | null; nextAction: string | null; days: number;
};
type Column = { stage: string; label: string; count: number; value: number; cards: Card[] };

const ACCENT: Record<string, string> = {
  new: "bg-info", contacted: "bg-sage", qualified: "bg-emerald", follow_up: "bg-sage", site_visit_scheduled: "bg-champagne",
  negotiation: "bg-warning", booked: "bg-positive", lost: "bg-danger",
};

export function Board({ columns, currency, perColumn, canWrite, canBook }: { columns: Column[]; currency: string; perColumn: number; canWrite: boolean; canBook: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [optimistic, applyMove] = useOptimistic(columns, (cols: Column[], move: { id: string; to: string }) => {
    const card = cols.flatMap((c) => c.cards).find((c) => c.id === move.id);
    if (!card) return cols;
    return cols.map((c) => ({
      ...c,
      cards: c.stage === move.to ? [card, ...c.cards.filter((x) => x.id !== move.id)] : c.cards.filter((x) => x.id !== move.id),
    }));
  });

  const move = (id: string, from: string, to: string) => {
    if (from === to) return;
    if (to === "booked") {
      if (canBook) router.push(`/bookings/new?lead=${id}`);
      else toast("Ask a manager to record the booking for this lead.", "error");
      return;
    }
    let reason: string | null = null;
    if (to === "lost") {
      reason = window.prompt("Why was this lead lost?");
      if (!reason?.trim()) return;
    }
    start(async () => {
      applyMove({ id, to });
      const fd = new FormData();
      fd.set("id", id);
      fd.set("stage", to);
      if (reason) fd.set("lostReason", reason);
      const res = await changeStageAction(null, fd);
      if (res?.error) toast(res.error, "error");
      else toast("Stage updated.");
    });
  };

  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8", pending && "cursor-progress")}>
      <div className="flex min-w-max gap-3">
        {optimistic.map((col) => (
          <section
            key={col.stage}
            aria-label={`${col.label} column`}
            onDragOver={(e) => {
              if (!canWrite) return;
              e.preventDefault();
              setOver(col.stage);
            }}
            onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const [id, from] = e.dataTransfer.getData("text/plain").split("|");
              if (id) move(id, from, col.stage);
            }}
            className={cn("flex w-[272px] shrink-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface/60 transition-colors", over === col.stage && "border-emerald bg-emerald-soft/40")}
          >
            <header className="border-b border-line px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", ACCENT[col.stage])} />
                <h2 className="text-[13.5px] font-semibold">{col.label}</h2>
                <span className="tnum ml-auto rounded bg-ink/[0.06] px-1.5 text-xs text-ink-2">{col.count}</span>
              </div>
              <div className="tnum mt-0.5 text-xs text-muted">{col.value ? `≈ ${formatMoney(col.value, currency, true)}` : "—"}</div>
            </header>
            <ul className="flex max-h-[calc(100dvh-260px)] min-h-24 flex-col gap-2 overflow-y-auto p-2">
              {col.cards.map((c) => (
                <li
                  key={c.id}
                  draggable={canWrite}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", `${c.id}|${col.stage}`);
                    e.dataTransfer.effectAllowed = "move";
                    setDragging(c.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={cn("group rounded-md border border-line bg-surface p-2.5 shadow-card", canWrite && "cursor-grab active:cursor-grabbing", dragging === c.id && "opacity-50")}
                >
                  <div className="flex items-start gap-1.5">
                    {canWrite && <GripVertical className="mt-0.5 size-3.5 shrink-0 text-line-strong group-hover:text-muted" aria-hidden />}
                    <Link href={`/leads/${c.id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-medium hover:underline">{c.name}</Link>
                    {canWrite && (
                      <details className="relative">
                        <summary className="list-none rounded p-0.5 text-muted hover:bg-ink/5 hover:text-ink [&::-webkit-details-marker]:hidden" aria-label={`Move ${c.name}`}>
                          <MoreHorizontal className="size-4" />
                        </summary>
                        <div className="absolute right-0 top-6 z-10 w-48 rounded-md border border-line bg-surface p-1 shadow-pop">
                          <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted">Move to</div>
                          {optimistic.filter((x) => x.stage !== col.stage).map((x) => (
                            <button key={x.stage} type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; move(c.id, col.stage, x.stage); }} className="block w-full rounded px-2 py-1 text-left text-[13px] hover:bg-ivory">
                              {x.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
                    {c.intent && <Badge tone={c.intent === "hot" ? "danger" : c.intent === "warm" ? "warning" : "info"}>{c.intent} · {c.score}</Badge>}
                    {c.budgetMax != null && <span className="tnum">{formatMoney(c.budgetMax, currency, true)}</span>}
                    <span className={cn(c.days > 14 && col.stage !== "booked" && col.stage !== "lost" && "font-medium text-warning")}>{c.days}d in stage</span>
                  </div>
                  <div className="mt-1 truncate text-[11.5px] text-ink-2">{c.owner ?? "Unassigned"}{c.project ? ` · ${c.project}` : ""}</div>
                  {c.nextAction && col.stage !== "booked" && col.stage !== "lost" && <div className="mt-1.5 line-clamp-2 border-t border-line pt-1.5 text-[11.5px] text-ink-2">→ {c.nextAction}</div>}
                </li>
              ))}
              {col.cards.length === 0 && <li className="py-6 text-center text-xs text-muted">No leads</li>}
              {col.count > perColumn && (
                <li className="py-1 text-center text-xs">
                  <Link href={`/leads?stage=${col.stage}&sort=score`} className="text-emerald hover:underline">View all {col.count}</Link>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
