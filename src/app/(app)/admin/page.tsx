import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { withSystem } from "@/lib/db/tenant";
import { PageHeader, Panel } from "@/components/ui/panel";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils";

export const metadata: Metadata = { title: "Platform admin" };

/** Super Admin: platform-level overview of tenants (aggregate counts only — no tenant records). */
export default async function AdminPage() {
  const session = await requireSession();
  if (!session.isSuperAdmin) notFound();
  const orgs = await withSystem(async (tx) =>
    (
      await tx.execute<{ id: string; name: string; plan: string; created_at: string; members: string; leads: string; bookings: string }>(sql`
        select o.id, o.name, o.plan, o.created_at,
          (select count(*) from memberships m where m.organization_id = o.id and m.is_active) as members,
          (select count(*) from leads l where l.organization_id = o.id) as leads,
          (select count(*) from bookings b where b.organization_id = o.id) as bookings
        from organizations o order by o.created_at desc limit 500`)
    ).rows,
  );
  return (
    <>
      <PageHeader title="Platform admin" description="Organizations on this Oikos AI deployment. Tenant data is not visible here — only counts." />
      <Panel>
        <Table>
          <THead><TH>Organization</TH><TH>Plan</TH><TH className="text-right">Members</TH><TH className="text-right">Leads</TH><TH className="text-right">Bookings</TH><TH>Created</TH></THead>
          <tbody>
            {orgs.map((o) => (
              <TR key={o.id}>
                <TD className="font-medium">{o.name}</TD><TD>{o.plan}</TD>
                <TD className="tnum text-right">{formatNumber(Number(o.members))}</TD>
                <TD className="tnum text-right">{formatNumber(Number(o.leads))}</TD>
                <TD className="tnum text-right">{formatNumber(Number(o.bookings))}</TD>
                <TD>{formatDate(new Date(o.created_at))}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
