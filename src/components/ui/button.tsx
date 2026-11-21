import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none";
const variants: Record<Variant, string> = {
  primary: "bg-forest text-white hover:bg-forest-2 shadow-card",
  accent: "bg-emerald text-white hover:bg-forest-2 shadow-card",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-ivory shadow-card",
  ghost: "text-ink-2 hover:bg-ink/5 hover:text-ink",
  danger: "bg-surface text-danger border border-danger/30 hover:bg-danger-soft",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-9 px-3.5 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
