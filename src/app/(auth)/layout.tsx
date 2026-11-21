import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/app/logo";
import { Toaster } from "@/components/ui/toast";

const points = [
  "Every lead, follow-up and site visit in one pipeline",
  "Explainable lead scores built from your own data",
  "Inventory, bookings and collections that stay in sync",
  "Marketing ROI traced from spend to booking",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-forest p-10 text-ivory lg:flex">
        <Link href="/" aria-label="Oikos AI home">
          <Logo light />
        </Link>
        <div className="max-w-md">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-champagne">Real estate revenue platform</p>
          <h2 className="mt-3 font-display text-[32px] font-bold leading-tight text-ivory">
            The operating system for real estate sales and revenue.
          </h2>
          <ul className="mt-8 space-y-3 text-[14px] text-ivory/80">
            {points.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-champagne" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ivory/50">© {new Date().getFullYear()} Oikos AI</p>
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 size-80 rounded-full border border-ivory/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-10 -right-10 size-52 rounded-full border border-ivory/10" />
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-8 inline-block lg:hidden" aria-label="Oikos AI home">
            <Logo />
          </Link>
          {children}
        </div>
      </main>
      <Suspense>
        <Toaster />
      </Suspense>
    </div>
  );
}
