"use client";

import { createContext, useActionState, useContext, useEffect, useMemo, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useSubmit } from "@/lib/use-submit";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import { Button } from "./button";
import { useDialog } from "./dialog";
import { toast } from "./toast";
import { Notice } from "./states";
import { Field, Input, Select, Textarea } from "./field";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Fires the result toast as soon as the server action returns — not in an effect — so it still
 * shows when the triggering button disappears after the refresh (e.g. "Revoke", "Mark read").
 */
function withToasts(action: Action, opts: { successMessage?: string; errorToast?: boolean }): Action {
  return async (prev, fd) => {
    const res = await action(prev, fd);
    if (res?.ok) {
      const msg = res.message ?? opts.successMessage;
      if (msg) toast(msg, "success");
    } else if (res?.error && opts.errorToast) {
      toast(res.error, "error");
    }
    return res;
  };
}

const FormStateCtx = createContext<ActionState>(null);
const PendingCtx = createContext(false);
export const useFormErrors = () => useContext(FormStateCtx)?.fieldErrors ?? {};

/**
 * Wraps a server action: shows pending state, inline field errors, a form-level error,
 * and a success toast. Inside a <Dialog>, closes it on success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  successMessage,
  onSuccess,
  id,
  keepOpen = false,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  onSuccess?: (state: ActionState) => void;
  id?: string;
  /** Keep a surrounding dialog open on success (e.g. to show a generated key). */
  keepOpen?: boolean;
}) {
  const wrapped = useMemo(() => withToasts(action, { successMessage }), [action, successMessage]);
  const [state, formAction, isPending] = useActionState(wrapped, null);
  const { pending, onSubmit } = useSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const dialog = useDialog();
  const last = useRef<ActionState>(null);

  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      if (!keepOpen) dialog?.close();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, dialog, onSuccess, keepOpen]);

  return (
    <FormStateCtx.Provider value={state}>
     <PendingCtx.Provider value={pending || isPending}>
      <form ref={formRef} onSubmit={onSubmit} className={className} id={id} aria-busy={pending || isPending}>
        {state?.error && (
          <div className="mb-3">
            <Notice tone="danger">{state.error}</Notice>
          </div>
        )}
        {children}
      </form>
     </PendingCtx.Provider>
    </FormStateCtx.Provider>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  pendingText,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "accent" | "ghost";
  size?: "sm" | "md";
  className?: string;
  pendingText?: string;
}) {
  const status = useFormStatus();
  const ctxPending = useContext(PendingCtx);
  const pending = status.pending || ctxPending;
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className} aria-busy={pending}>
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/** Field bound to the surrounding ActionForm's errors. */
export function FormField({
  label,
  name,
  hint,
  required,
  className,
  type = "text",
  defaultValue,
  placeholder,
  as = "input",
  options,
  inputProps,
}: {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  className?: string;
  type?: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  as?: "input" | "select" | "textarea";
  options?: { value: string; label: string }[];
  inputProps?: Record<string, unknown>;
}) {
  const errors = useFormErrors();
  const error = errors[name];
  const common = {
    name,
    required,
    defaultValue: defaultValue ?? undefined,
    "aria-invalid": error ? true : undefined,
    ...inputProps,
  };
  return (
    <Field label={label} name={name} error={error} hint={hint} required={required} className={className}>
      {as === "select" ? (
        <Select {...common} defaultValue={common.defaultValue === undefined ? "" : String(common.defaultValue)}>
          {!required && <option value="">—</option>}
          {required && <option value="" disabled>Select…</option>}
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : as === "textarea" ? (
        <Textarea {...common} placeholder={placeholder} />
      ) : (
        <Input {...common} type={type} placeholder={placeholder} />
      )}
    </Field>
  );
}

/** A small inline form posting hidden fields to an action (e.g. "Mark done"), with optional confirm. */
export function InlineAction({
  action,
  fields,
  children,
  confirm,
  variant = "secondary",
  size = "sm",
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  children: React.ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "danger" | "accent" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  const wrapped = useMemo(() => withToasts(action, { errorToast: true }), [action]);
  const [, formAction, isPending] = useActionState(wrapped, null);
  const { pending, onSubmit } = useSubmit(formAction);
  return (
    <PendingCtx.Provider value={pending || isPending}>
    <form
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) {
          e.preventDefault();
          return;
        }
        onSubmit(e);
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} size={size}>
        {children}
      </SubmitButton>
    </form>
    </PendingCtx.Provider>
  );
}
