"use client";

import { useTransition } from "react";

/**
 * Submits a form to a server action inside a transition instead of via the `action` prop.
 * React resets uncontrolled forms after an `action` submission — which would wipe what the
 * user typed when validation fails. Submitting this way keeps the values.
 */
export function useSubmit(dispatch: (fd: FormData) => void) {
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    start(() => dispatch(fd));
  };
  return { pending, onSubmit };
}
