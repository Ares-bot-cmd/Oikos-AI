import type { Metadata } from "next";
import { FileDown, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { dateRange, type SearchParams } from "@/lib/list-params";
import { REPORTS } from "@/lib/services/reports";
import { PageHeader, Panel } from "@/components/ui/panel";
import { DateRangeFilter } from "@/components/ui/filters";
import { NoAccess } from "@/components/app/bits";

export const metadata: Metadata = { title: "Reports" };

const NEEDS: Partial<Record<keyof typeof REPORTS, "marketing:read" | "revenue:read">> = { marketing_roi: "marketing:read", revenue: "revenue:read" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireSession();
  if (!can(session.role, "reports:read")) return <NoAccess what="reports" />;
  const sp = await searchParams;
  const { current } = dateRange(sp, "30d");
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => ["range", "from", "to"].includes(k) && typeof v === "string") as [string, string][]);
  const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Downloadable reports for ${fmt(current.from)} – ${fmt(new Date(current.to.getTime() - 1))}. Every download is recorded in the audit log.`}
        actions={<DateRangeFilter />}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Object.entries(REPORTS).map(([key, r]) => {
          const perm = NEEDS[key as keyof typeof REPORTS];
          const allowed = !perm || can(session.role, perm);
          const href = (f: string) => `/api/reports/${key}?${new URLSearchParams([...qs, ["format", f]]).toString()}`;
          return (
            <Panel key={key} className="flex flex-col p-4">
              <FileText className="size-5 text-emerald" />
              <h2 className="mt-2 text-[15px] font-semibold">{r.title}</h2>
              <p className="mt-1 flex-1 text-[13px] text-muted">{r.description}</p>
              {allowed ? (
                <div className="mt-4 flex gap-2">
                  <a href={href("csv")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] font-medium shadow-card hover:bg-ivory"><FileDown className="size-3.5" /> CSV</a>
                  <a href={href("pdf")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-forest px-2.5 text-[13px] font-medium text-white shadow-card hover:bg-forest-2"><FileDown className="size-3.5" /> PDF</a>
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted">Not available for your role.</p>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
