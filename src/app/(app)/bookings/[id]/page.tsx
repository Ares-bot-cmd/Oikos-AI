import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { bookingDetail, PAYMENT_METHOD_LABELS } from "@/lib/services/bookings";
import { DefinitionList, PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { Stat } from "@/components/ui/stat";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { InlineAction } from "@/components/ui/form";
import { Notice } from "@/components/ui/states";
import { StatusBadge } from "@/components/app/bits";
import { Meter } from "@/components/charts";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatPercent } from "@/lib/utils";
import { deleteMilestoneAction, deletePaymentAction } from "../actions";
import { AddMilestoneButton, CancelBookingButton, RecordPaymentButton } from "../forms";

export const metadata: Metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, data } = await loadPage((tx, ctx) => bookingDetail(tx, ctx, id));
  const { booking: b, milestones, payments, totals } = data;
  const cur = session.currency;
  const m = (v: number | null) => formatMoney(v, cur);
  const canPay = can(session.role, "payments:write") && b.status !== "cancelled";
  const discount = b.unit.price - b.agreementValue;

  return (
    <>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Bookings</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{b.customerName} <StatusBadge status={b.status} /></span>}
        description={`${b.projectName} · Unit ${b.unit.tower ? `${b.unit.tower}-` : ""}${b.unit.unitNumber} · ${b.unit.configuration} · booked ${formatDate(b.bookingDate)}`}
        actions={canPay && <><RecordPaymentButton bookingId={b.id} outstanding={totals.outstanding} currency={cur} milestones={milestones.filter((x) => x.status !== "paid").map((x) => ({ value: x.id, label: `${x.name} · ${formatMoney(x.outstanding, cur, true)} due ${formatDate(x.dueDate)}` }))} /><CancelBookingButton id={b.id} paid={totals.paid} currency={cur} /></>}
      />
      {b.status === "cancelled" && (
        <div className="mb-4"><Notice tone="danger">Cancelled {b.cancelledAt ? formatDateTime(b.cancelledAt, session.timezone) : ""}: {b.cancellationReason}. Refund: {m(b.refundAmount ?? 0)}.</Notice></div>
      )}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Agreement value" value={formatMoney(b.agreementValue, cur, true)} hint={discount > 0 ? `${formatMoney(discount, cur, true)} below list price` : "at list price"} />
        <Stat label="Received" value={formatMoney(totals.paid, cur, true)} hint={formatPercent(b.agreementValue ? totals.paid / b.agreementValue : 0, 0) + " collected"} />
        <Stat label="Outstanding" value={formatMoney(totals.outstanding, cur, true)} />
        <Stat label="Overdue" value={formatMoney(totals.overdue, cur, true)} className={totals.overdue > 0 ? "border-danger/30" : undefined} />
      </section>
      <div className="mt-2"><Meter value={b.agreementValue ? totals.paid / b.agreementValue : 0} /></div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Payment milestones"
              description={totals.unscheduled > 0.5 ? `${formatMoney(totals.unscheduled, cur)} of the agreement value isn't scheduled yet` : "Payments apply to milestones in due-date order"}
              actions={canPay && totals.unscheduled > 0.5 && <AddMilestoneButton bookingId={b.id} unscheduled={totals.unscheduled} currency={cur} />}
            />
            <Table>
              <THead><TH>Milestone</TH><TH>Due</TH><TH className="text-right">Amount</TH><TH className="text-right">Paid</TH><TH className="text-right">Outstanding</TH><TH>Status</TH>{canPay && <TH />}</THead>
              <tbody>
                {milestones.map((x) => (
                  <TR key={x.id}>
                    <TD className="font-medium">{x.name}</TD>
                    <TD className="whitespace-nowrap">{formatDate(x.dueDate)}</TD>
                    <TD className="tnum text-right">{m(x.amount)}</TD>
                    <TD className="tnum text-right">{m(x.paid)}</TD>
                    <TD className="tnum text-right">{m(x.outstanding)}</TD>
                    <TD><StatusBadge status={x.status} /></TD>
                    {canPay && <TD className="text-right">{x.paid === 0 && <InlineAction action={deleteMilestoneAction} fields={{ id: x.id }} variant="ghost" confirm="Remove this milestone?">Remove</InlineAction>}</TD>}
                  </TR>
                ))}
                {!milestones.length && <TR><TD colSpan={7} className="py-6 text-center text-muted">No payment schedule yet. Add milestones to track dues.</TD></TR>}
              </tbody>
            </Table>
          </Panel>
          <Panel>
            <PanelHeader title="Transactions" />
            <Table>
              <THead><TH>Date</TH><TH className="text-right">Amount</TH><TH>Method</TH><TH>Reference</TH><TH>Recorded by</TH>{canPay && <TH />}</THead>
              <tbody>
                {payments.map((p) => (
                  <TR key={p.id}>
                    <TD className="whitespace-nowrap">{formatDate(p.paidOn)}</TD>
                    <TD className="tnum text-right font-medium">{m(p.amount)}</TD>
                    <TD>{PAYMENT_METHOD_LABELS[p.method]}{p.milestoneName && <div className="text-xs text-muted">{p.milestoneName}</div>}</TD>
                    <TD className="text-ink-2">{p.reference ?? "—"}{p.notes && <div className="text-xs text-muted">{p.notes}</div>}</TD>
                    <TD className="text-ink-2">{p.recordedBy ?? "—"}</TD>
                    {canPay && <TD className="text-right"><InlineAction action={deletePaymentAction} fields={{ id: p.id }} variant="ghost" confirm="Delete this payment record? This is logged.">Delete</InlineAction></TD>}
                  </TR>
                ))}
                {!payments.length && <TR><TD colSpan={6} className="py-6 text-center text-muted">No payments recorded yet.</TD></TR>}
              </tbody>
            </Table>
          </Panel>
        </div>
        <Panel className="self-start">
          <PanelHeader title="Booking details" />
          <div className="p-4">
            <DefinitionList
              items={[
                { label: "Customer phone", value: b.customerPhone }, { label: "Customer email", value: b.customerEmail },
                { label: "Lead", value: b.leadId ? <Link href={`/leads/${b.leadId}`} className="text-emerald hover:underline">Open lead</Link> : null },
                { label: "Sales executive", value: b.salesName }, { label: "Booking amount", value: m(b.bookingAmount) },
                { label: "Unit list price", value: m(b.unit.price) }, { label: "Carpet area", value: `${formatNumber(b.unit.carpetArea)} ft²` },
                { label: "Floor", value: b.unit.floor }, { label: "Source", value: b.source?.replace(/_/g, " ") ?? null },
              ]}
            />
            {b.notes && <p className="mt-4 whitespace-pre-wrap text-[13px] text-ink-2">{b.notes}</p>}
          </div>
        </Panel>
      </div>
    </>
  );
}
