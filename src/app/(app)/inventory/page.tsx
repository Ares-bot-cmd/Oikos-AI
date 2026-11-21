import type { Metadata } from "next";
import { LayoutGrid } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { listParams, param, type SearchParams } from "@/lib/list-params";
import { configurations, listUnits, projectOptions, UNIT_SORTS, UNIT_STATUSES } from "@/lib/services/projects";
import { PageHeader, Panel } from "@/components/ui/panel";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/filters";
import { Pagination, SortTH } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Stat } from "@/components/ui/stat";
import { LinkButton } from "@/components/ui/button";
import { formatMoney, formatNumber } from "@/lib/utils";
import { UnitsTable } from "./units-table";
import { AddUnitButton, BulkUnitsButton } from "../projects/forms";

export const metadata: Metadata = { title: "Inventory" };

const PRICE_BANDS = [
  { value: "0-5000000", label: "Under ₹50 L" }, { value: "5000000-10000000", label: "₹50 L – ₹1 Cr" },
  { value: "10000000-20000000", label: "₹1 – 2 Cr" }, { value: "20000000-", label: "Over ₹2 Cr" },
];

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const lp = listParams(sp, UNIT_SORTS, "unit", "asc");
  const [minP, maxP] = (param(sp, "price") ?? "").split("-");
  const { session, data } = await loadPage(async (tx) => {
    const [units, projects, configs] = await Promise.all([
      listUnits(tx, {
        project: param(sp, "project"), status: param(sp, "status"), configuration: param(sp, "configuration"), q: lp.q,
        minPrice: minP ? Number(minP) : undefined, maxPrice: maxP ? Number(maxP) : undefined, sort: lp.sort, dir: lp.dir, limit: lp.limit, offset: lp.offset,
      }),
      projectOptions(tx),
      configurations(tx),
    ]);
    return { units, projects, configs };
  });
  const { units } = data;
  const projects = data.projects.map((p) => ({ value: p.id, label: p.name }));
  const cur = session.currency;
  const s = units.summary;
  const canWrite = can(session.role, "projects:write");

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every unit across your projects. Status updates automatically with reservations, bookings and cancellations."
        actions={canWrite && <><AddUnitButton projects={projects} /><BulkUnitsButton projects={projects} /></>}
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={formatNumber(s.available.n)} hint={formatMoney(s.available.value, cur, true)} />
        <Stat label="Reserved" value={formatNumber(s.reserved.n)} hint={formatMoney(s.reserved.value, cur, true)} />
        <Stat label="Booked" value={formatNumber(s.booked.n)} hint={formatMoney(s.booked.value, cur, true)} />
        <Stat label="Sold" value={formatNumber(s.sold.n)} hint={formatMoney(s.sold.value, cur, true)} />
      </section>
      <Panel className="mt-4">
        <FilterBar>
          <SearchBox placeholder="Unit number" className="w-full sm:w-44" />
          {projects.length > 0 && <FilterSelect name="project" label="All projects" options={projects} />}
          <FilterSelect name="status" label="All statuses" options={UNIT_STATUSES.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} />
          {data.configs.length > 0 && <FilterSelect name="configuration" label="All configurations" options={data.configs.map((c) => ({ value: c, label: c }))} />}
          <FilterSelect name="price" label="Any price" options={PRICE_BANDS} />
        </FilterBar>
        {units.total === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title={projects.length ? "No units match" : "No inventory yet"}
            description={projects.length ? "Change the filters, or add units to a project." : "Create a project first, then generate its units."}
            action={!projects.length && <LinkButton href="/projects">Go to projects</LinkButton>}
          />
        ) : (
          <>
            <UnitsTable
              rows={units.rows}
              currency={cur}
              canWrite={canWrite}
              canBook={can(session.role, "bookings:write")}
              projects={projects}
              sortHeader={(label, field, className) => <SortTH key={field} label={label} field={field} pathname="/inventory" sp={sp} sort={lp.sort} dir={lp.dir} className={className} />}
            />
            <Pagination pathname="/inventory" sp={sp} page={lp.page} total={units.total} />
          </>
        )}
      </Panel>
    </>
  );
}
