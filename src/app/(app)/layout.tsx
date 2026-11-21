import { Suspense } from "react";
import Link from "next/link";
import { after } from "next/server";
import { Bell } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { withTenant } from "@/lib/db/tenant";
import { NAV } from "@/components/app/nav";
import { Sidebar } from "@/components/app/sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { Toaster } from "@/components/ui/toast";
import { unreadCount } from "@/lib/services/notifications";
import { followUpCounts } from "@/lib/services/followups";
import { userOrganizations } from "@/lib/services/accounts";
import { maybeSweep } from "@/lib/services/sweep";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const ctx = { orgId: session.orgId, userId: session.userId, role: session.role };
  const [{ unread, overdue }, orgs] = await Promise.all([
    withTenant(ctx, async (tx) => ({ unread: await unreadCount(tx, session.userId), overdue: (await followUpCounts(tx, ctx)).overdue })),
    userOrganizations(session.userId),
  ]);
  // Time-based reminders and rescoring, throttled per organization; runs after the response.
  after(() => maybeSweep(session.orgId).catch((e) => console.error("[sweep]", e)));

  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.permission || can(session.role, i.permission)) })).filter((s) => s.items.length);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Sidebar sections={sections} orgName={session.orgName} badges={{ "/follow-ups": overdue, "/notifications": unread }} />
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-2 border-b border-line bg-ivory/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-ivory/70 sm:px-6">
          <Link href="/notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} className="relative inline-flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-ink/5">
            <Bell className="size-[18px]" />
            {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-champagne ring-2 ring-ivory" />}
          </Link>
          <UserMenu name={session.name} email={session.email} roleLabel={ROLE_LABELS[session.role]} orgs={orgs} currentOrgId={session.orgId} />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
      <Suspense>
        <Toaster />
      </Suspense>
    </div>
  );
}
