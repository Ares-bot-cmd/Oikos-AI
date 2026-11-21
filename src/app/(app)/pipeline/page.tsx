import type { Metadata } from "next";
import { and, sql } from "drizzle-orm";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { param, type SearchParams } from "@/lib/list-params";
import { leads, projects, users } from "@/lib/db/schema";
import { leadScope, leadWhere, memberOptions, STAGE_LABELS, STAGES } from "@/lib/services/leads";
import { projectOptions } from "@/lib/services/projects";
import { PageHeader } from "@/components/ui/panel";
import { FilterSelect, SearchBox } from "@/components/ui/filters";
import { Board, type Card } from "./board";

export const metadata: Metadata = { title: "Lead Pipeline" };

const PER_COLUMN = 60;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = { q: param(sp, "q"), owner: param(sp, "owner"), project: param(sp, "project"), intent: param(sp, "intent") };
  const { session, data } = await loadPage(async (tx, ctx) => {
    const where = leadWhere(ctx, filters);
    const [counts, cards, members, projs] = await Promise.all([
      tx
        .select({
          stage: leads.stage,
          n: sql<number>`count(*)`.mapWith(Number),
          value: sql<number>`coalesce(sum(coalesce((${leads.budgetMin} + ${leads.budgetMax}) / 2, ${leads.budgetMax}, ${leads.budgetMin})), 0)`.mapWith(Number),
        })
        .from(leads)
        .where(and(where, leadScope(ctx)))
        .groupBy(leads.stage),
      // Top cards per stage by score, using a window function.
      tx.execute<{ id: string; name: string; stage: string; score: number | null; intent: string | null; budget_max: string | null; owner: string | null; project: string | null; next_action: string | null; days: number }>(sql`
        select * from (
          select ${leads.id} as id, ${leads.name} as name, ${leads.stage} as stage, ${leads.score} as score, ${leads.intent} as intent,
            ${leads.budgetMax} as budget_max, ${users.name} as owner, ${projects.name} as project, ${leads.nextAction} as next_action,
            floor(extract(epoch from now() - ${leads.stageChangedAt}) / 86400)::int as days,
            row_number() over (partition by ${leads.stage} order by ${leads.score} desc nulls last, ${leads.createdAt} desc) as rn
          from ${leads} left join ${users} on ${users.id} = ${leads.ownerId} left join ${projects} on ${projects.id} = ${leads.projectId}
          where ${where ?? sql`true`}
        ) t where rn <= ${PER_COLUMN}`),
      memberOptions(tx),
      projectOptions(tx),
    ]);
    return { counts, cards: cards.rows, members, projs };
  });
  const byStage = Object.fromEntries(data.counts.map((c) => [c.stage, c]));
  const columns = STAGES.map((s) => ({
    stage: s, label: STAGE_LABELS[s], count: byStage[s]?.n ?? 0, value: byStage[s]?.value ?? 0,
    cards: data.cards.filter((c) => c.stage === s).map<Card>((c) => ({
      id: c.id, name: c.name, score: c.score, intent: c.intent as Card["intent"], budgetMax: c.budget_max == null ? null : Number(c.budget_max),
      owner: c.owner, project: c.project, nextAction: c.next_action, days: Number(c.days),
    })),
  }));

  return (
    <>
      <PageHeader
        title="Lead Pipeline"
        description="Drag a card to move it to another stage, or use its menu. Values are estimated from each lead's budget."
        actions={
          <>
            <SearchBox placeholder="Search leads" className="w-full sm:w-56" />
            {can(session.role, "leads:read_all") && <FilterSelect name="owner" label="All owners" options={[{ value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }, ...data.members.map((m) => ({ value: m.id, label: m.name }))]} />}
            {data.projs.length > 0 && <FilterSelect name="project" label="All projects" options={data.projs.map((p) => ({ value: p.id, label: p.name }))} />}
            <FilterSelect name="intent" label="Any intent" options={[{ value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }]} />
          </>
        }
      />
      <Board columns={columns} currency={session.currency} perColumn={PER_COLUMN} canWrite={can(session.role, "leads:write")} canBook={can(session.role, "bookings:write")} />
    </>
  );
}

