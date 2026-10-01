"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FieldLabel, FormError, fieldCls, submitCls } from "@/components/public/AuthShell";
import { signup, type FormState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitCls}>
      {pending ? "Creating your account…" : "Create account"}
      {!pending && <span className="pub-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

export default function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signup, {});
  return (
    <form action={action} className="mt-9">
      <label className="block">
        <FieldLabel>Email</FieldLabel>
        <input name="email" type="email" autoComplete="username" required placeholder="you@example.com" className={fieldCls} />
      </label>

      <label className="mt-5 block">
        <FieldLabel>Password</FieldLabel>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" className={fieldCls} />
      </label>

      <label className="mt-5 block">
        <FieldLabel>Confirm password</FieldLabel>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={8} placeholder="Re-enter your password" className={fieldCls} />
      </label>

      {state.error && <FormError>{state.error}</FormError>}

      <Submit />
    </form>
  );
}
