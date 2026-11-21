import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWith, PAGE_SIZE, type SearchParams } from "@/lib/list-params";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-line bg-ivory/60 text-xs font-medium text-muted">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <th scope="col" className={cn("whitespace-nowrap px-4 py-2.5 font-medium", className)}>{children}</th>;
}

export function SortTH({
  label,
  field,
  pathname,
  sp,
  sort,
  dir,
  className,
}: {
  label: string;
  field: string;
  pathname: string;
  sp: SearchParams;
  sort: string;
  dir: "asc" | "desc";
  className?: string;
}) {
  const active = sort === field;
  const nextDir = active && dir === "desc" ? "asc" : "desc";
  return (
    <th scope="col" className={cn("whitespace-nowrap px-4 py-2.5 font-medium", className)} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={hrefWith(pathname, sp, { sort: field, dir: nextDir, page: undefined })} className={cn("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}>
        {label}
        {active && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </Link>
    </th>
  );
}

export function TR({ className, children }: { className?: string; children: React.ReactNode }) {
  return <tr className={cn("border-b border-line last:border-0 hover:bg-ivory/50", className)}>{children}</tr>;
}

export function TD({ className, children, colSpan }: { className?: string; children?: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("px-4 py-2.5 align-middle", className)}>{children}</td>;
}

export function Pagination({ pathname, sp, page, total }: { pathname: string; sp: SearchParams; page: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-muted">
      <span className="tnum">
        {start}–{end} of {total.toLocaleString("en-IN")}
      </span>
      <div className="flex items-center gap-1">
        <PageLink disabled={page <= 1} href={hrefWith(pathname, sp, { page: page - 1 })} label="Previous page">
          <ChevronLeft className="size-4" />
        </PageLink>
        <span className="tnum px-2">
          Page {page} of {pages}
        </span>
        <PageLink disabled={page >= pages} href={hrefWith(pathname, sp, { page: page + 1 })} label="Next page">
          <ChevronRight className="size-4" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ disabled, href, label, children }: { disabled: boolean; href: string; label: string; children: React.ReactNode }) {
  const cls = "inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface";
  if (disabled) return <span aria-disabled className={cn(cls, "opacity-40")} aria-label={label}>{children}</span>;
  return <Link href={href} className={cn(cls, "hover:bg-ivory")} aria-label={label}>{children}</Link>;
}
