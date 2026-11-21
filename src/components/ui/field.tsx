import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted/70 shadow-[inset_0_1px_0_rgb(0_0_0/0.02)] transition-colors focus:border-emerald focus:outline-none focus:ring-2 focus:ring-emerald/15 disabled:bg-ivory disabled:text-muted aria-[invalid=true]:border-danger";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-[13px] font-medium text-ink-2", className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  name,
  error,
  hint,
  className,
  children,
  required,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${name}-error`} className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-ink-2", className)}>
      <input type="checkbox" className="size-4 rounded border-line-strong accent-emerald" {...props} />
      {label}
    </label>
  );
}
