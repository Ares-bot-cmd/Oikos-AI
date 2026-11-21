import type { Metadata } from "next";
import { Download, Upload, Users } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { hrefWith, listParams, param, type SearchParams } from "@/lib/list-params";
import { LEAD_SORTS, listLeads, SOURCE_LABELS, SOURCES, STAGE_LABELS, STAGES } from "@/lib/services/leads";
import { PageHeader, Panel } from "@/components/ui/panel";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { Pagination } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { leadFormOptions } from "./options";
import { NewLeadButton } from "./new-lead-button";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = { title: "Lead Management" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const lp = listParams(sp, LEAD_SORTS, "created");
  const filters = {
    q: lp.q, stage: param(sp, "stage"), owner: param(sp, "owner"), source: param(sp, "source"), project: param(sp, "project"),
    campaign: param(sp, "campaign"), intent: param(sp, "intent"), priority: param(sp, "priority"), tag: param(sp, "tag"),
    duplicates: param(sp, "duplicates") === "1",
  };
  const { session, data } = await loadPage(async (tx, ctx) => {
    const [list, options] = await Promise.all([
      listLeads(tx, ctx, { ...filters, sort: lp.sort, dir: lp.dir, limit: lp.limit, offset: lp.offset }),
      leadFormOptions(tx, ctx),
    ]);
    return { list, options };
  });
  const { list, options } = data;
  const filtered = Object.values(filters).some(Boolean);
  const exportQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v === true ? "1" : v)])).toString();

  return (
    <>
      <PageHeader
        title="Lead Management"
        description="Every enquiry with its owner, stage and AI score. Click a lead for its full history."
        actions={
          <>
            {can(session.role, "leads:import") && <LinkButton href="/leads/import"><Upload className="size-4" /> Import</LinkButton>}
            {can(session.role, "leads:export") && <a href={`/api/leads/export${exportQs ? "?" + exportQs : ""}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium shadow-card hover:bg-ivory"><Download className="size-4" /> Export CSV</a>}
            <NewLeadButton options={options} />
          </>
        }
      />
      <Panel>
        <FilterBar>
          <SearchBox placeholder="Search name, phone or email" className="w-full sm:w-72" />
          <FilterSelect name="stage" label="All stages" options={[{ value: "open", label: "Open (not booked/lost)" }, ...STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))]} />
          {can(session.role, "leads:read_all") && (
            <FilterSelect name="owner" label="All owners" options={[{ value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }, ...options.members]} />
          )}
          <FilterSelect name="intent" label="Any intent" options={[{ value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }]} />
          <FilterSelect name="source" label="All sources" options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} />
          {options.projects.length > 0 && <FilterSelect name="project" label="All projects" options={options.projects} />}
          <FilterSelect name="priority" label="Any priority" options={["urgent", "high", "medium", "low"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
          <FilterSelect name="duplicates" label="All leads" options={[{ value: "1", label: "Possible duplicates" }]} />
          {filtered && <LinkButton href="/leads" variant="ghost" size="sm">Clear filters</LinkButton>}
        </FilterBar>
        {list.total === 0 ? (
          <EmptyState
            icon={Users}
            title={filtered ? "No leads match these filters" : "No leads yet"}
            description={filtered ? "Try removing a filter or searching for something else." : "Add a lead, import a spreadsheet, or connect a lead source under Integrations."}
            action={filtered ? <LinkButton href="/leads">Clear filters</LinkButton> : <div className="flex gap-2"><NewLeadButton options={options} label="Add your first lead" /><LinkButton href="/leads/import"><Upload className="size-4" /> Import</LinkButton></div>}
          />
        ) : (
          <>
            <LeadsTable
              rows={list.rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastContactedAt: r.lastContactedAt?.toISOString() ?? null }))}
              members={options.members}
              canAssign={options.canAssign}
              currency={session.currency}
              sort={lp.sort}
              dir={lp.dir}
              sortLinks={Object.fromEntries(LEAD_SORTS.map((f) => [f, hrefWith("/leads", sp, { sort: f, dir: lp.sort === f && lp.dir === "desc" ? "asc" : "desc", page: undefined })]))}
            />
            <Pagination pathname="/leads" sp={sp} page={lp.page} total={list.total} />
          </>
        )}
      </Panel>
    </>
  );
}

