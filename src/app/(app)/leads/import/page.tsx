import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { memberOptions } from "@/lib/services/leads";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { NoAccess } from "@/components/app/bits";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Import leads" };

const COLUMNS = [
  ["name / full_name", "Customer name (required unless phone/email present)"],
  ["phone / mobile", "Phone number — 10-digit Indian numbers get +91"],
  ["email", "Email address"],
  ["budget / budget_max, budget_min", "Numbers, or values like 85 lakh, 1.2 cr"],
  ["location / city", "Preferred location"],
  ["property_type, configuration / bhk", "e.g. Apartment, 2BHK"],
  ["timeline", "immediate, within 3 months, within 6 months, later"],
  ["project, campaign", "Matched to existing projects/campaigns by name"],
  ["source", "website, meta_ads, google_ads, portal, referral, walk_in…"],
  ["notes / remarks, tags", "Free text; tags comma separated"],
];

export default async function ImportPage() {
  const { session, data } = await loadPage(async (tx) => ({ members: await memberOptions(tx) }));
  if (!can(session.role, "leads:import")) return <NoAccess what="lead import" />;
  return (
    <>
      <Link href="/leads" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Leads</Link>
      <PageHeader title="Import leads" description="Upload a CSV or Excel (.xlsx) file — up to 2,000 rows and 4 MB. Duplicates are detected by phone number and email." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelHeader title="Upload file" />
          <div className="p-4">
            <ImportForm members={data.members.map((m) => ({ value: m.id, label: m.name }))} canAssign={can(session.role, "leads:assign")} />
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Recognised columns" description="Header names are matched case-insensitively; other columns are ignored." />
          <dl className="divide-y divide-line text-[13px]">
            {COLUMNS.map(([k, v]) => (
              <div key={k} className="px-4 py-2"><dt className="font-mono text-[12px] text-forest">{k}</dt><dd className="text-muted">{v}</dd></div>
            ))}
          </dl>
        </Panel>
      </div>
    </>
  );
}
