import type { Metadata } from "next";
import Link from "next/link";
import { Contact as ContactIcon } from "lucide-react";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { loadPage } from "@/lib/server-action";
import { listParams, param, type SearchParams } from "@/lib/list-params";
import { bookings, leads, users } from "@/lib/db/schema";
import { leadScope } from "@/lib/services/leads";
import { PageHeader, Panel } from "@/components/ui/panel";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/filters";
import { Pagination, SortTH, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Contacts" };
const SORTS = ["name", "created"] as const;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const lp = listParams(sp, SORTS, "name", "asc");
  const type = param(sp, "type");
  const { data } = await loadPage(async (tx, ctx) => {
    const isCustomer = sql<boolean>`exists (select 1 from bookings b where b.lead_id = ${leads.id} and b.status <> 'cancelled')`;
    const where = and(
      leadScope(ctx),
      lp.q ? or(ilike(leads.name, `%${lp.q}%`), ilike(leads.email, `%${lp.q}%`), ilike(leads.phoneNormalized, `%${lp.q.replace(/\D/g, "") || "~"}%`)) : undefined,
      type === "customers" ? isCustomer : type === "prospects" ? sql`not ${isCustomer}` : undefined,
    );
    const dir = lp.dir === "asc" ? asc : desc;
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select({
          id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, location: leads.preferredLocation, owner: users.name,
          createdAt: leads.createdAt, isCustomer, units: sql<number>`(select count(*) from ${bookings} b where b.lead_id = ${leads.id} and b.status <> 'cancelled')`.mapWith(Number),
        })
        .from(leads)
        .leftJoin(users, eq(users.id, leads.ownerId))
        .where(where)
        .orderBy(lp.sort === "name" ? dir(leads.name) : dir(leads.createdAt))
        .limit(lp.limit)
        .offset(lp.offset),
      tx.select({ total: count() }).from(leads).where(where),
    ]);
    return { rows, total: Number(total) };
  });

  return (
    <>
      <PageHeader title="Contacts" description="Everyone you're in touch with — prospects and customers who have booked." />
      <Panel>
        <FilterBar>
          <SearchBox placeholder="Search name, phone or email" className="w-full sm:w-72" />
          <FilterSelect name="type" label="All contacts" options={[{ value: "customers", label: "Customers (booked)" }, { value: "prospects", label: "Prospects" }]} />
        </FilterBar>
        {data.total === 0 ? (
          <EmptyState icon={ContactIcon} title="No contacts found" description="Contacts are created automatically when you add or capture leads." />
        ) : (
          <>
            <Table>
              <THead>
                <SortTH label="Name" field="name" pathname="/contacts" sp={sp} sort={lp.sort} dir={lp.dir} />
                <TH>Phone</TH><TH>Email</TH><TH>Location</TH><TH>Owner</TH><TH>Status</TH>
                <SortTH label="Added" field="created" pathname="/contacts" sp={sp} sort={lp.sort} dir={lp.dir} />
              </THead>
              <tbody>
                {data.rows.map((c) => (
                  <TR key={c.id}>
                    <TD><Link href={`/leads/${c.id}`} className="font-medium hover:underline">{c.name}</Link></TD>
                    <TD className="whitespace-nowrap">{c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a> : "—"}</TD>
                    <TD>{c.email ? <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> : "—"}</TD>
                    <TD className="text-ink-2">{c.location ?? "—"}</TD>
                    <TD className="text-ink-2">{c.owner ?? "—"}</TD>
                    <TD>{c.isCustomer ? <Badge tone="positive">Customer · {c.units} unit{c.units === 1 ? "" : "s"}</Badge> : <Badge>Prospect</Badge>}</TD>
                    <TD className="whitespace-nowrap text-ink-2">{formatDate(c.createdAt)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination pathname="/contacts" sp={sp} page={lp.page} total={data.total} />
          </>
        )}
      </Panel>
    </>
  );
}
