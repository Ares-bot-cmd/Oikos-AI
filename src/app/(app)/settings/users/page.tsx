import type { Metadata } from "next";
import { loadPage } from "@/lib/server-action";
import { can, ROLE_LABELS, ROLES } from "@/lib/auth/permissions";
import { members, pendingInvitations } from "@/lib/services/org";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { NoAccess } from "@/components/app/bits";
import { formatDate, relativeTime } from "@/lib/utils";
import { revokeInviteAction, setActiveAction } from "../actions";
import { InviteButton, RoleSelect } from "../forms";

export const metadata: Metadata = { title: "Users & Roles" };

const ROLE_DESCRIPTIONS: Record<string, string> = {
  org_admin: "Everything, including settings, users, integrations and billing.",
  sales_manager: "All leads, assignment, team targets, bookings, payments, reports and automation.",
  sales_executive: "Only leads assigned to them: follow-ups, visits, WhatsApp and bookings for those leads.",
  marketing_manager: "All leads (read/write), campaigns and spend, marketing and revenue analytics, lead capture integrations.",
};

export default async function UsersSettings() {
  const { session, data } = await loadPage(async (tx) => ({ team: await members(tx), invites: await pendingInvitations(tx) }));
  if (!can(session.role, "users:manage")) return <NoAccess what="user management" />;
  const roles = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title="Team members" description={`${data.team.filter((m) => m.isActive).length} active`} actions={<InviteButton roles={roles} />} />
        <Table>
          <THead><TH>Name</TH><TH>Role</TH><TH className="text-right">Open leads</TH><TH>Last sign-in</TH><TH>Status</TH><TH /></THead>
          <tbody>
            {data.team.map((m) => (
              <TR key={m.membershipId}>
                <TD><div className="font-medium">{m.name}{m.userId === session.userId && <span className="ml-1.5 text-xs text-muted">(you)</span>}</div><div className="text-xs text-muted">{m.email}</div></TD>
                <TD><RoleSelect membershipId={m.membershipId} role={m.role} roles={roles} disabled={m.userId === session.userId} /></TD>
                <TD className="tnum text-right">{m.openLeads}</TD>
                <TD className="text-ink-2">{m.lastLoginAt ? relativeTime(m.lastLoginAt) : "Never"}</TD>
                <TD>{m.isActive ? <Badge tone="positive">Active</Badge> : <Badge>Deactivated</Badge>}</TD>
                <TD className="text-right">
                  {m.userId !== session.userId && (
                    <InlineAction action={setActiveAction} fields={{ membershipId: m.membershipId, active: String(!m.isActive) }} variant={m.isActive ? "danger" : "secondary"} confirm={m.isActive ? `Deactivate ${m.name}? They'll be signed out and their open leads unassigned.` : undefined}>
                      {m.isActive ? "Deactivate" : "Reactivate"}
                    </InlineAction>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Panel>
      {data.invites.length > 0 && (
        <Panel>
          <PanelHeader title="Pending invitations" />
          <ul className="divide-y divide-line">
            {data.invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                <div><span className="font-medium">{i.email}</span> · {ROLE_LABELS[i.role]}<div className="text-xs text-muted">expires {formatDate(i.expiresAt)}</div></div>
                <InlineAction action={revokeInviteAction} fields={{ id: i.id }} variant="ghost" confirm="Revoke this invitation?">Revoke</InlineAction>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel>
        <PanelHeader title="Roles" description="Permissions are enforced on the server and in the database for every request" />
        <dl className="divide-y divide-line">
          {ROLES.map((r) => <div key={r} className="px-4 py-2.5"><dt className="text-[13.5px] font-medium">{ROLE_LABELS[r]}</dt><dd className="text-[12.5px] text-muted">{ROLE_DESCRIPTIONS[r]}</dd></div>)}
        </dl>
      </Panel>
    </div>
  );
}
