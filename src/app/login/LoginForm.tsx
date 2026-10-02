"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FieldLabel, FormError, fieldCls, submitCls } from "@/components/public/AuthShell";
import PasswordField from "@/components/public/PasswordField";
import { login, type FormState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={submitCls}>
      {pending ? "Signing in…" : "Sign in"}
      {!pending && <span className="pub-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

export default function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(login, {});

  return (
    <form action={action} className="mt-9">
      <label className="block">
        <FieldLabel>Email</FieldLabel>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
          className={fieldCls}
        />
      </label>

      <PasswordField className="mt-5" label="Password" name="password" autoComplete="current-password" placeholder="••••••••" />

      {state.error && <FormError>{state.error}</FormError>}

      <Submit />
    </form>
  );
}
