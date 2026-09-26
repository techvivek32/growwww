"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signup, type FormState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 flex h-12 w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white transition-colors hover:bg-brandh disabled:opacity-60"
    >
      {pending ? "Creating your account…" : "Create account"}
    </button>
  );
}

const field =
  "h-12 w-full rounded-lg border border-line bg-surface px-3.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-brand";

export default function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signup, {});
  return (
    <form action={action} className="mt-7">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Email</span>
        <input name="email" type="email" autoComplete="username" required placeholder="you@example.com" className={field} />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Password</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="At least 8 characters" className={field} />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={8} placeholder="Re-enter your password" className={field} />
      </label>

      {state.error && (
        <p role="alert" className="mt-4 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] leading-snug text-down">
          {state.error}
        </p>
      )}

      <Submit />
    </form>
  );
}
