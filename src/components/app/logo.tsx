import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="7" fill="#28634B" />
      <path d="M16 6.5 6.5 14v11.5h7v-7h5v7h7V14L16 6.5Z" fill="none" stroke="#F5F3EC" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="16" cy="14.2" r="1.6" fill="#B99A64" />
    </svg>
  );
}

export function Logo({ light = false, className }: { light?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cn("font-display text-[17px] font-bold tracking-tight", light ? "text-ivory" : "text-forest")}>
        Oikos <span className={light ? "text-champagne" : "text-emerald"}>AI</span>
      </span>
    </span>
  );
}
