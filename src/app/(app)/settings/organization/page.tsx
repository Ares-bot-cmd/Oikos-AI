import type { Metadata } from "next";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { customFields, getOrganization } from "@/lib/services/org";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { NoAccess } from "@/components/app/bits";
import { deleteCustomFieldAction } from "../actions";
import { AddCustomFieldButton, OrgForm } from "../forms";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrganizationSettings() {
  const { session, data } = await loadPage(async (tx, ctx) => ({ org: await getOrganization(tx, ctx.orgId), fields: await customFields(tx) }));
  if (!can(session.role, "org:manage")) return <NoAccess what="organization settings" />;
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Organization" description="Name, currency, time zone and alert thresholds" />
        <div className="p-4"><OrgForm org={data.org} /></div>
      </Panel>
      <Panel>
        <PanelHeader title="Custom lead fields" description="Extra fields captured on every lead (shown on the lead form and profile)" actions={<AddCustomFieldButton />} />
        <ul className="divide-y divide-line">
          {data.fields.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="text-[13.5px]"><span className="font-medium">{f.label}</span> <Badge>{f.fieldType}</Badge>{f.options && <span className="ml-2 text-xs text-muted">{f.options.join(", ")}</span>}</div>
              <InlineAction action={deleteCustomFieldAction} fields={{ id: f.id }} variant="ghost" confirm={`Remove the "${f.label}" field? Values already saved on leads are kept but hidden.`}>Remove</InlineAction>
            </li>
          ))}
          {!data.fields.length && <li className="px-4 py-6 text-center text-[13px] text-muted">No custom fields yet.</li>}
        </ul>
      </Panel>
    </div>
  );
}
