import type { Metadata } from "next";
import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { dateRange, listParams, param, type SearchParams } from "@/lib/list-params";
import { BOOKING_SORTS, listBookings } from "@/lib/services/bookings";
import { projectOptions } from "@/lib/services/projects";
import { PageHeader, Panel } from "@/components/ui/panel";
import { DateRangeFilter, FilterBar, FilterSelect, SearchBox } from "@/components/ui/filters";
import { Pagination, SortTH, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { LinkButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/bits";
import { Meter } from "@/components/charts";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const lp = listParams(sp, BOOKING_SORTS, "date");
  const hasRange = !!param(sp, "range");
  const { current } = dateRange(sp, "12m");
  const { session, data } = await loadPage(async (tx, ctx) => {
    const [list, projects] = await Promise.all([
      listBookings(tx, ctx, {
        q: lp.q, status: param(sp, "status"), project: param(sp, "project"), from: hasRange ? current.from : undefined, to: hasRange ? current.to : undefined,
        sort: lp.sort, dir: lp.dir, limit: lp.limit, offset: lp.offset,
      }),
      projectOptions(tx),
    ]);
    return { list, projects };
  });
  const cur = session.currency;
  const { list } = data;

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Every booking with its unit, agreement value and collection progress."
        actions={can(session.role, "bookings:write") && <LinkButton href="/bookings/new" variant="primary"><Plus className="size-4" /> Record booking</LinkButton>}
      />
      <Panel>
        <FilterBar>
          <SearchBox placeholder="Customer or unit" className="w-full sm:w-56" />
          <FilterSelect name="status" label="All statuses" options={[{ value: "active", label: "Active" }, { value: "completed", label: "Fully paid" }, { value: "cancelled", label: "Cancelled" }]} />
          {data.projects.length > 0 && <FilterSelect name="project" label="All projects" options={data.projects.map((p) => ({ value: p.id, label: p.name }))} />}
          <DateRangeFilter fallback="12m" />
        </FilterBar>
        {list.total === 0 ? (
          <EmptyState icon={FileSignature} title="No bookings found" description="Record a booking from a lead's page when the customer pays the booking amount." action={can(session.role, "bookings:write") && <LinkButton href="/bookings/new" variant="primary">Record booking</LinkButton>} />
        ) : (
          <>
            <Table>
              <THead>
                <SortTH label="Customer" field="customer" pathname="/bookings" sp={sp} sort={lp.sort} dir={lp.dir} />
                <TH>Unit</TH>
                <SortTH label="Date" field="date" pathname="/bookings" sp={sp} sort={lp.sort} dir={lp.dir} />
                <SortTH label="Agreement value" field="value" pathname="/bookings" sp={sp} sort={lp.sort} dir={lp.dir} className="text-right" />
                <SortTH label="Received" field="paid" pathname="/bookings" sp={sp} sort={lp.sort} dir={lp.dir} className="text-right" />
                <TH>Collection</TH><TH>Executive</TH><TH>Status</TH>
              </THead>
              <tbody>
                {list.rows.map((b) => (
                  <TR key={b.id}>
                    <TD><Link href={`/bookings/${b.id}`} className="font-medium hover:underline">{b.customerName}</Link></TD>
                    <TD>{b.projectName}<div className="text-xs text-muted">{b.tower ? `${b.tower}-` : ""}{b.unitNumber}</div></TD>
                    <TD className="whitespace-nowrap">{formatDate(b.bookingDate)}</TD>
                    <TD className="tnum text-right">{formatMoney(b.agreementValue, cur, true)}</TD>
                    <TD className="tnum text-right">{formatMoney(b.paid, cur, true)}</TD>
                    <TD className="w-32"><Meter value={b.agreementValue ? b.paid / b.agreementValue : 0} /></TD>
                    <TD className="text-ink-2">{b.salesName ?? "—"}</TD>
                    <TD><StatusBadge status={b.status} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination pathname="/bookings" sp={sp} page={lp.page} total={list.total} />
          </>
        )}
      </Panel>
    </>
  );
}
