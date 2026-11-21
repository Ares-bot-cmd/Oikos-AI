import type { Metadata } from "next";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { hrefWith, listParams, param, type SearchParams } from "@/lib/list-params";
import { listNotifications } from "@/lib/services/notifications";
import { PageHeader, Panel } from "@/components/ui/panel";
import { Pagination } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { InlineAction } from "@/components/ui/form";
import { Tabs } from "@/components/app/tabs";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { markAllReadAction, markReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const unreadOnly = param(sp, "view") !== "all";
  const lp = listParams(sp, ["date"], "date");
  const { session, data } = await loadPage((tx, _ctx, s) => listNotifications(tx, s.userId, { unreadOnly, limit: lp.limit, offset: lp.offset }));
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Missed follow-ups, new and qualified leads, upcoming site visits, payment reminders and automation alerts."
        actions={unreadOnly && data.total > 0 && <InlineAction action={markAllReadAction} fields={{}} size="md">Mark all as read</InlineAction>}
      />
      <Panel>
        <Tabs active={unreadOnly ? "unread" : "all"} tabs={[{ key: "unread", label: "Unread", href: hrefWith("/notifications", sp, { view: undefined, page: undefined }) }, { key: "all", label: "All", href: hrefWith("/notifications", sp, { view: "all", page: undefined }) }]} />
        {data.total === 0 ? (
          <EmptyState icon={BellOff} title={unreadOnly ? "You're all caught up" : "No notifications yet"} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {data.rows.map((n) => (
                <li key={n.id} className={cn("flex items-start gap-3 px-4 py-3", !n.readAt && "bg-emerald-soft/25")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-champagne")} />
                  <div className="min-w-0 flex-1">
                    {n.link ? <Link href={n.link} className="text-[13.5px] font-medium hover:underline">{n.title}</Link> : <span className="text-[13.5px] font-medium">{n.title}</span>}
                    {n.body && <p className="text-[12.5px] text-ink-2">{n.body}</p>}
                    <time className="text-xs text-muted" title={formatDateTime(n.createdAt, session.timezone)}>{relativeTime(n.createdAt)}</time>
                  </div>
                  {!n.readAt && <InlineAction action={markReadAction} fields={{ id: n.id }} variant="ghost">Mark read</InlineAction>}
                </li>
              ))}
            </ul>
            <Pagination pathname="/notifications" sp={sp} page={lp.page} total={data.total} />
          </>
        )}
      </Panel>
    </>
  );
}
