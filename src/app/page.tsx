import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Building2, MessageCircle, ShieldCheck, Sparkles, Users } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { Logo } from "@/components/app/logo";
import { buttonClass } from "@/components/ui/button";

const FEATURES = [
  { icon: Users, title: "CRM & pipeline", text: "Capture leads from forms, ads, WhatsApp and imports. Assign, follow up and move them through a Kanban pipeline with full history." },
  { icon: Sparkles, title: "Explainable lead intelligence", text: "Every score shows the facts behind it — budget fit against live inventory, engagement, visits — and the next best action." },
  { icon: Building2, title: "Inventory, bookings & payments", text: "Projects, towers and units that stay in sync with reservations, bookings, payment milestones and collections." },
  { icon: BarChart3, title: "Marketing & revenue intelligence", text: "Cost per lead and per booking, ROI by campaign, actual vs projected revenue, and where revenue is leaking." },
  { icon: MessageCircle, title: "WhatsApp automation", text: "Official WhatsApp Cloud API: replies, templates, reminders and an AI agent that hands off to your team." },
  { icon: ShieldCheck, title: "Built for teams", text: "Role-based access, per-organization data isolation enforced in the database, and a complete audit log." },
];

export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="min-h-dvh bg-ivory">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("ghost")}>Sign in</Link>
          <Link href="/signup" className={buttonClass("primary")}>Create workspace</Link>
        </nav>
      </header>
      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-champagne">For developers, builders & sales teams</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-bold leading-[1.1] text-forest sm:text-5xl">
            The operating system for real estate sales and revenue.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-ink-2">
            Oikos AI takes every enquiry from first contact to booking and collection — and shows you exactly which campaigns,
            people and projects produce revenue.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClass("primary", "md", "h-11 px-5 text-[15px]")}>Start your workspace</Link>
            <Link href="/login" className={buttonClass("secondary", "md", "h-11 px-5 text-[15px]")}>Sign in</Link>
          </div>
        </section>
        <section className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-px bg-line px-0 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-surface p-6 sm:p-8">
                <f.icon className="size-5 text-emerald" />
                <h2 className="mt-3 text-[16px] font-semibold">{f.title}</h2>
                <p className="mt-1.5 text-[13.5px] text-ink-2">{f.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-muted sm:px-6">© {new Date().getFullYear()} Oikos AI</footer>
    </div>
  );
}
