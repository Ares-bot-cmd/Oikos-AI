import type { Metadata } from "next";
import Link from "next/link";
import { and, sql } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { param, type SearchParams } from "@/lib/list-params";
import { leads } from "@/lib/db/schema";
import { leadScope, memberOptions } from "@/lib/services/leads";
import { availableUnitsFor } from "@/lib/services/projects";
import { PAYMENT_PLANS } from "@/lib/services/bookings";
import { PageHeader, Panel } from "@/components/ui/panel";
import { NoAccess } from "@/components/app/bits";
import { BookingForm } from "../forms";

export const metadata: Metadata = { title: "Record booking" };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const leadParam = param(sp, "lead");
  const { session, data } = await loadPage(async (tx, ctx) => {
    const [openLeads, members] = await Promise.all([
      tx
        .select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, projectId: leads.projectId })
        .from(leads)
        .where(and(leadScope(ctx), sql`${leads.stage} not in ('booked','lost')`))
        .orderBy(leads.name)
        .limit(2000),
      memberOptions(tx),
    ]);
    const leadId = openLeads.some((l) => l.id === leadParam) ? leadParam : undefined;
    const units = await availableUnitsFor(tx, undefined, leadId);
    return { openLeads, members, units, leadId };
  });
  if (!can(session.role, "bookings:write")) return <NoAccess what="bookings" />;
  return (
    <>
      <Link href="/bookings" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Bookings</Link>
      <PageHeader title="Record a booking" description="Links the customer, unit and value. The unit is marked booked, the lead moves to Booked, and the payment schedule is created." />
      <Panel className="max-w-3xl p-5">
        <BookingForm
          leads={data.openLeads.map((l) => ({ value: l.id, label: `${l.name}${l.phone ? ` · ${l.phone}` : ""}`, name: l.name, phone: l.phone, email: l.email, projectId: l.projectId }))}
          units={data.units.map((u) => ({ value: u.id, label: `${u.label}${u.status === "reserved" ? " (reserved for this lead)" : ""}`, price: u.price, projectId: u.projectId }))}
          members={data.members.map((m) => ({ value: m.id, label: m.name }))}
          plans={Object.entries(PAYMENT_PLANS).map(([k, v]) => ({ value: k, label: v.label }))}
          defaultLead={data.leadId}
          canAssign={can(session.role, "leads:assign")}
          currency={session.currency}
        />
      </Panel>
    </>
  );
}
