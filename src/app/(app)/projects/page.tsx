import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MapPin } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { param, type SearchParams } from "@/lib/list-params";
import { listProjects, PROJECT_STATUS_LABELS, PROJECT_STATUSES } from "@/lib/services/projects";
import { PageHeader, Panel } from "@/components/ui/panel";
import { FilterSelect, SearchBox } from "@/components/ui/filters";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/charts";
import { formatMoney, formatPercent } from "@/lib/utils";
import { NewProjectButton } from "./forms";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { session, data } = await loadPage((tx) => listProjects(tx, { q: param(sp, "q"), status: param(sp, "status") }));
  const canWrite = can(session.role, "projects:write");
  const m = (v: number | null) => formatMoney(v, session.currency, true);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Your developments, their inventory and sales progress."
        actions={
          <>
            <SearchBox placeholder="Search projects" className="w-full sm:w-56" />
            <FilterSelect name="status" label="All statuses" options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))} />
            {canWrite && <NewProjectButton />}
          </>
        }
      />
      {data.length === 0 ? (
        <Panel>
          <EmptyState icon={Building2} title="No projects yet" description="Add a project, then generate its units to start tracking availability, bookings and revenue." action={canWrite && <NewProjectButton label="Add your first project" />} />
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => {
            const absorption = p.unitCount ? p.booked / p.unitCount : null;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className="group rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card transition-colors hover:border-emerald/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-semibold group-hover:text-emerald">{p.name}</h2>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-muted"><MapPin className="size-3" />{p.location}{p.city ? `, ${p.city}` : ""}</p>
                  </div>
                  <Badge tone="brand">{PROJECT_STATUS_LABELS[p.status]}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Mini label="Available" value={p.available} />
                  <Mini label="Reserved" value={p.reserved} />
                  <Mini label="Booked/sold" value={p.booked} />
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-muted"><span>Absorption</span><span className="tnum">{formatPercent(absorption, 0)} of {p.unitCount} units</span></div>
                  <Meter value={absorption} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-[12.5px]">
                  <div><dt className="text-muted">Booked value</dt><dd className="tnum font-medium">{m(p.bookedValue)}</dd></div>
                  <div><dt className="text-muted">Unsold inventory</dt><dd className="tnum font-medium">{m(p.inventoryValue)}</dd></div>
                  <div><dt className="text-muted">Price range</dt><dd className="tnum">{p.priceFrom || p.priceTo ? `${m(p.priceFrom)} – ${m(p.priceTo)}` : "—"}</dd></div>
                  <div><dt className="text-muted">Leads</dt><dd className="tnum">{p.leadCount}</dd></div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-ivory py-2">
      <div className="tnum font-display text-lg font-bold">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
