"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { FieldLabel, FormError, fieldCls, submitCls } from "@/components/public/AuthShell";
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
  const [show, setShow] = useState(false);

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

      {/* The toggle sits outside the <label>, or its text would join the field's accessible name. */}
      <div className="mt-5">
        <label htmlFor="password" className="block">
          <FieldLabel>Password</FieldLabel>
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={`${fieldCls} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label="Show password"
            aria-pressed={show}
            aria-controls="password"
            className="absolute top-1/2 right-1 grid h-9 w-9 -translate-y-1/2 place-items-center text-pub-muted transition-colors hover:text-pub-cream"
          >
            {show ? (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8" />
                <path d="M16.7 16.7A9.6 9.6 0 0 1 12 18c-5 0-9-6-9-6a17 17 0 0 1 4.1-4.7M9.9 5.2A9.6 9.6 0 0 1 12 5c5 0 9 6 9 6a17 17 0 0 1-2.2 2.9" />
              </svg>
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {state.error && <FormError>{state.error}</FormError>}

      <Submit />
    </form>
  );
}
