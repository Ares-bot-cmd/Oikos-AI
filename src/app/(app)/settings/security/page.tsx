import type { Metadata } from "next";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { listParams, type SearchParams } from "@/lib/list-params";
import { auditLog, mySessions } from "@/lib/services/org";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Pagination, Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { revokeSessionAction } from "../actions";
import { PasswordForm } from "../forms";

export const metadata: Metadata = { title: "Security" };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

export default async function SecuritySettings({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const lp = listParams(sp, ["date"], "date");
  const { session, data } = await loadPage(async (tx, ctx) => ({ log: can(ctx.role, "audit:read") ? await auditLog(tx, ctx, lp.limit, lp.offset) : null }));
  const sessions = await mySessions(session.userId);
  const tz = session.timezone;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Change password" description="Changing your password signs out your other sessions" />
          <div className="p-4"><PasswordForm /></div>
        </Panel>
        <Panel>
          <PanelHeader title="Active sessions" description="Devices signed in to your account" actions={sessions.length > 1 && <InlineAction action={revokeSessionAction} fields={{ id: "others" }} variant="secondary" confirm="Sign out all other sessions?">Sign out others</InlineAction>} />
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13.5px]">
                <div>
                  <div className="font-medium">{device(s.userAgent)} {s.id === session.sessionId && <Badge tone="positive">This device</Badge>}</div>
                  <div className="text-xs text-muted">IP {s.ip ?? "unknown"} · active {relativeTime(s.lastSeenAt)} · expires {formatDateTime(s.expiresAt, tz)}</div>
                </div>
                {s.id !== session.sessionId && <InlineAction action={revokeSessionAction} fields={{ id: s.id }} variant="ghost">Sign out</InlineAction>}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Security controls" />
        <ul className="grid gap-x-6 gap-y-2 p-4 text-[13px] text-ink-2 sm:grid-cols-2">
          <li>• Organization data is isolated by row-level security in the database.</li>
          <li>• Passwords are hashed with bcrypt; accounts lock for 15 minutes after 5 failed sign-ins.</li>
          <li>• Session cookies are HttpOnly, Secure and SameSite; sessions expire after 14 days.</li>
          <li>• Integration credentials are encrypted at rest (AES-256-GCM).</li>
          <li>• Webhooks are verified with signatures or secret tokens.</li>
          <li>• Sign-in, sign-up, API and public forms are rate-limited.</li>
        </ul>
      </Panel>
      {data.log && (
        <Panel>
          <PanelHeader title="Audit log" description="Sensitive actions across your organization" />
          <Table>
            <THead><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Details</TH><TH>IP</TH></THead>
            <tbody>
              {data.log.rows.map((a) => (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(a.createdAt, tz)}</TD>
                  <TD>{a.userName ?? "System"}</TD>
                  <TD><code className="text-[12px]">{a.action}</code></TD>
                  <TD className="max-w-md truncate text-xs text-muted">{a.details ? JSON.stringify(a.details) : "—"}</TD>
                  <TD className="text-xs text-muted">{a.ip ?? "—"}</TD>
                </TR>
              ))}
              {!data.log.rows.length && <TR><TD colSpan={5} className="py-6 text-center text-muted">No audit events yet.</TD></TR>}
            </tbody>
          </Table>
          <Pagination pathname="/settings/security" sp={sp} page={lp.page} total={data.log.total} />
        </Panel>
      )}
    </div>
  );
}
