"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { login, type FormState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 flex h-12 w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white transition-colors hover:bg-brandh focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

const field =
  "h-12 w-full rounded-lg border border-line bg-surface px-3.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-brand";

export default function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(login, {});
  const [show, setShow] = useState(false);

  return (
    <form action={action} className="mt-7">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
          className={field}
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Password</span>
        <span className="relative block">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={`${field} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-1 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-ink3 transition-colors hover:bg-surfaceh hover:text-ink"
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
        </span>
      </label>

      {state.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] leading-snug text-down"
        >
          {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}
