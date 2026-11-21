import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Bot, CheckCheck, Check, Clock, MessageCircle, UserRound, XCircle } from "lucide-react";
import { loadPage } from "@/lib/server-action";
import { can } from "@/lib/auth/permissions";
import { aiAvailable } from "@/lib/ai/claude";
import { organizations } from "@/lib/db/schema";
import { param, type SearchParams } from "@/lib/list-params";
import { conversation, getWhatsApp, inbox, templates, withinSessionWindow } from "@/lib/services/whatsapp";
import { getLead } from "@/lib/services/leads";
import { PageHeader, Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState, Notice } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { InlineAction } from "@/components/ui/form";
import { LinkButton } from "@/components/ui/button";
import { NoAccess } from "@/components/app/bits";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { deleteTemplateAction, setHandoffAction, toggleAgentAction } from "./actions";
import { Composer, NewTemplateButton } from "./composer";

export const metadata: Metadata = { title: "WhatsApp Agent" };

const STATUS_ICON = { pending: Clock, sent: Check, delivered: CheckCheck, read: CheckCheck, failed: XCircle, received: null } as const;

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filter = (["all", "handoff", "unanswered"].includes(param(sp, "filter") ?? "") ? param(sp, "filter") : "all") as "all" | "handoff" | "unanswered";
  const leadId = param(sp, "lead");
  const { session, data } = await loadPage(async (tx, ctx) => {
    if (!can(ctx.role, "whatsapp:send")) return null;
    const [wa, list, tpls, [org]] = await Promise.all([
      getWhatsApp(tx), inbox(tx, ctx, filter), templates(tx), tx.select({ ai: organizations.aiAgentEnabled }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    ]);
    const selected = leadId ? await getLead(tx, ctx, leadId) : null;
    const msgs = selected ? await conversation(tx, selected.id) : [];
    return { connected: !!wa, displayPhone: wa?.config.displayPhone, list, tpls, aiEnabled: org.ai, selected, msgs };
  });
  if (!data) return <NoAccess what="WhatsApp" />;
  const tz = session.timezone;
  const sel = data.selected;
  const windowOpen = sel ? withinSessionWindow(sel.lastInboundAt) : false;

  return (
    <>
      <PageHeader
        title="WhatsApp Agent"
        description="Conversations through the official WhatsApp Business Cloud API. Delivery and read receipts come from Meta's webhooks."
        actions={
          can(session.role, "org:manage") && (
            <InlineAction action={toggleAgentAction} fields={{ enabled: String(!data.aiEnabled) }} variant={data.aiEnabled ? "secondary" : "accent"} size="md" confirm={data.aiEnabled ? "Turn off the AI agent? New messages will wait for your team." : "Turn on the AI agent? It will reply to inbound WhatsApp messages using your project data and hand off to your team when needed."}>
              <Bot className="size-4" /> {data.aiEnabled ? "AI agent: on" : "Enable AI agent"}
            </InlineAction>
          )
        }
      />
      {!data.connected && (
        <div className="mb-4"><Notice tone="warning">WhatsApp isn&apos;t connected yet, so messages can&apos;t be sent or received. {can(session.role, "integrations:manage") ? <Link href="/settings/integrations" className="font-medium underline">Connect it in Integrations</Link> : "Ask an admin to connect it."}</Notice></div>
      )}
      {data.aiEnabled && !aiAvailable() && <div className="mb-4"><Notice tone="warning">The AI agent is on but the server has no ANTHROPIC_API_KEY, so it can&apos;t reply.</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Panel className="self-start">
          <nav className="flex gap-1 border-b border-line p-2" aria-label="Inbox filter">
            {(["all", "unanswered", "handoff"] as const).map((f) => (
              <Link key={f} href={`/whatsapp?filter=${f}${leadId ? `&lead=${leadId}` : ""}`} className={cn("rounded-md px-2.5 py-1 text-[13px]", filter === f ? "bg-emerald-soft font-medium text-forest" : "text-muted hover:text-ink")}>
                {f === "all" ? "All" : f === "unanswered" ? "Awaiting reply" : "Human handoff"}
              </Link>
            ))}
          </nav>
          <ul className="max-h-[620px] divide-y divide-line overflow-y-auto">
            {data.list.map((c) => (
              <li key={c.lead_id}>
                <Link href={`/whatsapp?filter=${filter}&lead=${c.lead_id}`} className={cn("block px-3 py-2.5 hover:bg-ivory", c.lead_id === leadId && "bg-emerald-soft/40")}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{c.name}</span>
                    {c.whatsapp_handoff && <Badge tone="gold">Human</Badge>}
                    {c.direction === "inbound" && <span className="ml-auto size-2 shrink-0 rounded-full bg-champagne" aria-label="Awaiting reply" />}
                  </div>
                  <div className="flex gap-2 text-xs text-muted"><span className="truncate">{c.direction === "outbound" ? "You: " : ""}{c.body}</span><span className="ml-auto shrink-0">{relativeTime(c.created_at)}</span></div>
                </Link>
              </li>
            ))}
            {!data.list.length && <li className="px-3 py-10 text-center text-[13px] text-muted">No conversations yet. Inbound WhatsApp messages create leads automatically.</li>}
          </ul>
        </Panel>

        <Panel className="flex min-h-[520px] flex-col">
          {!sel ? (
            <EmptyState icon={MessageCircle} title="Select a conversation" description="Or open WhatsApp from any lead's page to start one with an approved template." />
          ) : (
            <>
              <PanelHeader
                title={<Link href={`/leads/${sel.id}`} className="hover:underline">{sel.name}</Link>}
                description={`${sel.phone ?? "No phone"} · ${windowOpen ? "conversation window open" : "window closed — templates only"}`}
                actions={
                  <InlineAction action={setHandoffAction} fields={{ leadId: sel.id, handoff: String(!sel.whatsappHandoff) }} variant="secondary">
                    {sel.whatsappHandoff ? <><Bot className="size-3.5" /> Hand back to AI</> : <><UserRound className="size-3.5" /> Take over</>}
                  </InlineAction>
                }
              />
              <ol className="flex-1 space-y-2 overflow-y-auto bg-ivory/50 p-4" aria-label="Messages">
                {data.msgs.map((m) => {
                  const Icon = STATUS_ICON[m.status];
                  return (
                    <li key={m.id} className={cn("max-w-[80%] rounded-lg px-3 py-2 text-[13.5px] shadow-card", m.direction === "outbound" ? "ml-auto bg-emerald-soft" : "bg-surface")}>
                      {m.templateName && <div className="mb-0.5 text-[11px] font-medium text-muted">Template · {m.templateName}</div>}
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">
                        {m.sentByAgent && <span className="inline-flex items-center gap-0.5"><Bot className="size-3" /> AI</span>}
                        <time>{formatDateTime(m.createdAt, tz)}</time>
                        {Icon && <Icon className={cn("size-3.5", m.status === "read" && "text-info", m.status === "failed" && "text-danger")} aria-label={m.status} />}
                      </div>
                      {m.status === "failed" && m.error && <div className="mt-1 text-[11.5px] text-danger">Not delivered: {m.error}</div>}
                    </li>
                  );
                })}
                {!data.msgs.length && <li className="py-10 text-center text-[13px] text-muted">No messages yet. Send an approved template to start the conversation.</li>}
              </ol>
              <Composer leadId={sel.id} windowOpen={windowOpen} connected={data.connected} templates={data.tpls.map((t) => ({ id: t.id, name: t.name, language: t.language, body: t.body, variableCount: t.variableCount }))} />
            </>
          )}
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHeader title="Message templates" description="Approved WhatsApp templates available for sending and automations" actions={can(session.role, "integrations:manage") && <NewTemplateButton />} />
        <ul className="divide-y divide-line">
          {data.tpls.map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13.5px] font-medium"><code>{t.name}</code><Badge>{t.language}</Badge><Badge tone="brand">{t.purpose.replace(/_/g, " ")}</Badge></div>
                <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-2">{t.body}</p>
              </div>
              {can(session.role, "integrations:manage") && <InlineAction action={deleteTemplateAction} fields={{ id: t.id }} variant="ghost" confirm="Remove this template from Oikos?">Remove</InlineAction>}
            </li>
          ))}
          {!data.tpls.length && <li className="px-4 py-6 text-center text-[13px] text-muted">No templates yet. Add the templates you&apos;ve had approved by Meta.</li>}
        </ul>
        {!data.connected && <div className="border-t border-line p-3 text-right"><LinkButton href="/settings/integrations" size="sm">Connect WhatsApp</LinkButton></div>}
      </Panel>
    </>
  );
}
