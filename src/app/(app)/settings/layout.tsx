import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { NAV } from "@/components/app/nav";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const items = NAV.find((s) => s.title === "Settings")!.items.filter((i) => !i.permission || can(session.role, i.permission));
  return (
    <>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted"><Link href="/settings/organization">Settings</Link></div>
      <SettingsNav items={items.map((i) => ({ href: i.href, label: i.label }))} />
      {children}
    </>
  );
}
