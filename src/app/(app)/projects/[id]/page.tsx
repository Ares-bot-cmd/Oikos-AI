import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { listParams, param, type SearchParams } from "@/lib/list-params";
import { getProject, listUnits, PROJECT_STATUS_LABELS, projectOptions, UNIT_SORTS, UNIT_STATUSES } from "@/lib/services/projects";
import { DefinitionList, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/filters";
import { Pagination } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney, formatNumber } from "@/lib/utils";
import { UnitsTable } from "../../inventory/units-table";
import { AddUnitButton, BulkUnitsButton, DeleteProjectButton, EditProjectButton } from "../forms";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const lp = listParams(sp, UNIT_SORTS, "unit", "asc");
  const { session, data } = await loadPage(async (tx) => {
    const project = await getProject(tx, id);
    const [units, projects] = await Promise.all([
      listUnits(tx, { project: project.id, status: param(sp, "status"), q: lp.q, sort: lp.sort, dir: lp.dir, limit: lp.limit, offset: lp.offset }),
      projectOptions(tx),
    ]);
    return { project, units, projects };
  });
  const { project: p, units } = data;
  const projects = data.projects.map((x) => ({ value: x.id, label: x.name }));
  const canWrite = can(session.role, "projects:write");
  const cur = session.currency;
  const s = units.summary;

  return (
    <>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Projects</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{p.name} <Badge tone="brand">{PROJECT_STATUS_LABELS[p.status]}</Badge></span>}
        description={`${p.location}${p.city ? `, ${p.city}` : ""} · ${p.propertyType}`}
        actions={canWrite && <><EditProjectButton project={p as never} /><DeleteProjectButton id={p.id} name={p.name} /></>}
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={formatNumber(s.available.n)} hint={formatMoney(s.available.value, cur, true)} />
        <Stat label="Reserved" value={formatNumber(s.reserved.n)} hint={formatMoney(s.reserved.value, cur, true)} />
        <Stat label="Booked" value={formatNumber(s.booked.n)} hint={formatMoney(s.booked.value, cur, true)} />
        <Stat label="Sold (registered)" value={formatNumber(s.sold.n)} hint={formatMoney(s.sold.value, cur, true)} />
      </section>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title="Units" description={`${units.total} unit${units.total === 1 ? "" : "s"} in inventory${p.totalUnits ? ` · ${p.totalUnits} planned` : ""}`} actions={canWrite && <><AddUnitButton projects={projects} projectId={p.id} /><BulkUnitsButton projects={projects} projectId={p.id} /></>} />
          <FilterBar>
            <SearchBox placeholder="Unit number" className="w-full sm:w-44" />
            <FilterSelect name="status" label="All statuses" options={UNIT_STATUSES.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} />
          </FilterBar>
          {units.total === 0 ? (
            <EmptyState icon={LayoutGrid} title="No units yet" description="Generate units floor by floor, or add them one at a time." action={canWrite && <BulkUnitsButton projects={projects} projectId={p.id} />} />
          ) : (
            <>
              <UnitsTable rows={units.rows} currency={cur} canWrite={canWrite} canBook={can(session.role, "bookings:write")} projects={projects} showProject={false} />
              <Pagination pathname={`/projects/${p.id}`} sp={sp} page={lp.page} total={units.total} />
            </>
          )}
        </Panel>
        <Panel className="self-start">
          <PanelHeader title="Project details" />
          <div className="p-4">
            <DefinitionList
              items={[
                { label: "Developer", value: p.developer }, { label: "RERA", value: p.reraNumber },
                { label: "Price range", value: p.priceFrom || p.priceTo ? `${formatMoney(p.priceFrom, cur, true)} – ${formatMoney(p.priceTo, cur, true)}` : null },
                { label: "Possession", value: p.possessionDate ? formatDate(p.possessionDate) : null },
                { label: "Planned units", value: p.totalUnits || null }, { label: "Added", value: formatDate(p.createdAt) },
              ]}
            />
            {p.amenities && <p className="mt-4 text-[13px] text-ink-2"><span className="font-medium text-ink">Amenities: </span>{p.amenities}</p>}
            {p.description && <p className="mt-3 whitespace-pre-wrap text-[13px] text-ink-2">{p.description}</p>}
          </div>
        </Panel>
      </div>
    </>
  );
}
