import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-emerald-soft text-emerald">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-ink/[0.06]", className)} />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-80" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "danger" | "positive"; children: React.ReactNode }) {
  const tones = {
    info: "border-info/20 bg-info-soft text-info",
    warning: "border-warning/25 bg-warning-soft text-warning",
    danger: "border-danger/25 bg-danger-soft text-danger",
    positive: "border-positive/25 bg-positive-soft text-positive",
  };
  return <div className={cn("rounded-md border px-3 py-2 text-[13px]", tones[tone])}>{children}</div>;
}
