import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { dateRange, hrefWith, listParams, param, type SearchParams } from "@/lib/list-params";
import { cancellations, listPayments, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, receivables } from "@/lib/services/bookings";
import { PageHeader, Panel } from "@/components/ui/panel";
import { DateRangeFilter, FilterBar, FilterSelect, SearchBox } from "@/components/ui/filters";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Stat } from "@/components/ui/stat";
import { StatusBadge } from "@/components/app/bits";
import { Tabs } from "@/components/app/tabs";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Payments" };
type View = "receivables" | "overdue" | "transactions" | "cancellations";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const raw = param(sp, "view") as View | undefined;
  const view: View = raw && ["receivables", "overdue", "transactions", "cancellations"].includes(raw) ? raw : "receivables";
  const lp = listParams(sp, ["date"], "date");
  const { current } = dateRange(sp, "90d");
  const { session, data } = await loadPage(async (tx, ctx) => {
    const rec = await receivables(tx, ctx);
    const tx_ = view === "transactions" ? await listPayments(tx, ctx, { q: lp.q, method: param(sp, "method"), from: current.from, to: current.to, limit: lp.limit, offset: lp.offset }) : null;
    const canc = view === "cancellations" ? await cancellations(tx, ctx) : [];
    return { rec, tx_, canc };
  });
  const cur = session.currency;
  const m = (v: number | null) => formatMoney(v, cur, true);
  const totalOutstanding = data.rec.reduce((s, b) => s + b.outstanding, 0);
  const totalOverdue = data.rec.reduce((s, b) => s + b.overdue, 0);
  const totalCollected = data.rec.reduce((s, b) => s + b.paid, 0);
  const dueSoon = data.rec.flatMap((b) => b.milestones.filter((x) => x.status === "due").map((x) => x.outstanding)).reduce((a, b) => a + b, 0);
  const q = lp.q?.toLowerCase();
  const rows = data.rec
    .filter((b) => (view === "overdue" ? b.overdue > 0 : b.outstanding > 0))
    .filter((b) => !q || b.customerName.toLowerCase().includes(q))
    .sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);

  return (
    <>
      <PageHeader title="Payments" description="Collections, outstanding balances, overdue milestones and cancellations across all bookings." />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected to date" value={m(totalCollected)} />
        <Stat label="Outstanding" value={m(totalOutstanding)} />
        <Stat label="Overdue" value={m(totalOverdue)} />
        <Stat label="Due in next 7 days" value={m(dueSoon)} />
      </section>
      <Panel className="mt-4">
        <Tabs
          active={view}
          tabs={[
            { key: "receivables", label: "Outstanding", href: hrefWith("/payments", sp, { view: undefined, page: undefined }) },
            { key: "overdue", label: "Overdue", count: data.rec.filter((b) => b.overdue > 0).length, tone: "danger", href: hrefWith("/payments", sp, { view: "overdue", page: undefined }) },
            { key: "transactions", label: "Transactions", href: hrefWith("/payments", sp, { view: "transactions", page: undefined }) },
            { key: "cancellations", label: "Cancellations", href: hrefWith("/payments", sp, { view: "cancellations", page: undefined }) },
          ]}
        />
        {view === "transactions" && data.tx_ ? (
          <>
            <FilterBar>
              <SearchBox placeholder="Customer" className="w-full sm:w-56" />
              <FilterSelect name="method" label="All methods" options={PAYMENT_METHODS.map((x) => ({ value: x, label: PAYMENT_METHOD_LABELS[x] }))} />
              <DateRangeFilter fallback="90d" />
              <span className="tnum ml-auto text-[13px] text-muted">Total: <span className="font-medium text-ink">{formatMoney(data.tx_.sum, cur)}</span></span>
            </FilterBar>
            {data.tx_.total === 0 ? <EmptyState icon={Wallet} title="No payments in this period" /> : (
              <>
                <Table>
                  <THead><TH>Date</TH><TH>Customer</TH><TH>Unit</TH><TH className="text-right">Amount</TH><TH>Method</TH><TH>Reference</TH></THead>
                  <tbody>
                    {data.tx_.rows.map((p) => (
                      <TR key={p.id}>
                        <TD className="whitespace-nowrap">{formatDate(p.paidOn)}</TD>
                        <TD><Link href={`/bookings/${p.bookingId}`} className="font-medium hover:underline">{p.customerName}</Link></TD>
                        <TD className="text-ink-2">{p.projectName} · {p.unitNumber}</TD>
                        <TD className="tnum text-right font-medium">{formatMoney(p.amount, cur)}</TD>
                        <TD>{PAYMENT_METHOD_LABELS[p.method]}</TD>
                        <TD className="text-ink-2">{p.reference ?? "—"}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
                <Pagination pathname="/payments" sp={sp} page={lp.page} total={data.tx_.total} />
              </>
            )}
          </>
        ) : view === "cancellations" ? (
          data.canc.length === 0 ? <EmptyState icon={Wallet} title="No cancelled bookings" /> : (
            <Table>
              <THead><TH>Cancelled</TH><TH>Customer</TH><TH>Unit</TH><TH className="text-right">Agreement value</TH><TH className="text-right">Refund</TH><TH>Reason</TH></THead>
              <tbody>
                {data.canc.map((c) => (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(c.cancelledAt, session.timezone)}</TD>
                    <TD><Link href={`/bookings/${c.id}`} className="font-medium hover:underline">{c.customerName}</Link></TD>
                    <TD className="text-ink-2">{c.projectName} · {c.unitNumber}</TD>
                    <TD className="tnum text-right">{m(c.agreementValue)}</TD>
                    <TD className="tnum text-right">{m(c.refundAmount)}</TD>
                    <TD className="max-w-sm text-ink-2">{c.reason}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )
        ) : (
          <>
            <FilterBar><SearchBox placeholder="Customer" className="w-full sm:w-56" /></FilterBar>
            {rows.length === 0 ? <EmptyState icon={Wallet} title={view === "overdue" ? "Nothing overdue" : "No outstanding balances"} /> : (
              <Table>
                <THead><TH>Customer</TH><TH>Unit</TH><TH className="text-right">Agreement</TH><TH className="text-right">Received</TH><TH className="text-right">Outstanding</TH><TH className="text-right">Overdue</TH><TH>Next milestone</TH></THead>
                <tbody>
                  {rows.map((b) => {
                    const next = b.milestones.find((x) => x.status !== "paid");
                    return (
                      <TR key={b.id}>
                        <TD><Link href={`/bookings/${b.id}`} className="font-medium hover:underline">{b.customerName}</Link></TD>
                        <TD className="text-ink-2">{b.projectName} · {b.tower ? `${b.tower}-` : ""}{b.unitNumber}</TD>
                        <TD className="tnum text-right">{m(b.agreementValue)}</TD>
                        <TD className="tnum text-right">{m(b.paid)}</TD>
                        <TD className="tnum text-right font-medium">{m(b.outstanding)}</TD>
                        <TD className={`tnum text-right ${b.overdue > 0 ? "font-medium text-danger" : "text-muted"}`}>{b.overdue > 0 ? m(b.overdue) : "—"}</TD>
                        <TD>{next ? <span className="flex items-center gap-2"><StatusBadge status={next.status} /><span className="text-xs text-ink-2">{next.name} · {formatDate(next.dueDate)}</span></span> : <span className="text-xs text-muted">No schedule</span>}</TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Panel>
    </>
  );
}
