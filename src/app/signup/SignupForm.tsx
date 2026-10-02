"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { FieldLabel, FormError, fieldCls, submitCls } from "@/components/public/AuthShell";
import { signup, type FormState } from "./actions";

const RESEND_SECONDS = 60;

function Submit({ idle, busy, intent }: { idle: string; busy: string; intent: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} className={submitCls}>
      {pending ? busy : idle}
      {!pending && <span className="pub-arrow" aria-hidden="true">→</span>}
    </button>
  );
}

function Details({ error }: { error?: string }) {
  return (
    <>
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

      {error && <FormError>{error}</FormError>}

      <Submit intent="start" idle="Email me a code" busy="Sending your code…" />
      <p className="mt-3 text-[12.5px] leading-relaxed text-pub-dim">
        We&apos;ll email a 6-digit code to confirm the address is yours — sent from mnhafinancials@gmail.com through
        Google&apos;s Gmail. No account is created until you enter it.
      </p>
    </>
  );
}

function Code({ email, error, info }: { email?: string; error?: string; info?: string }) {
  const [left, setLeft] = useState(RESEND_SECONDS);
  useEffect(() => {
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <p className="font-plex text-[11px] tracking-[0.12em] text-pub-coral uppercase">Check your email</p>
      <p className="mt-3 text-[15.5px] leading-relaxed text-pub-muted">
        We sent a 6-digit code to <strong className="text-pub-cream">{email}</strong>. It expires in 10 minutes. Can&apos;t
        find it? Check your spam or promotions folder.
      </p>

      <label className="mt-6 block">
        <FieldLabel>Verification code</FieldLabel>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          placeholder="••••••"
          className={`${fieldCls} font-plex text-[24px] tracking-[0.5em]`}
        />
      </label>

      {error && <FormError>{error}</FormError>}
      {info && !error && <p role="status" className="mt-4 text-[14px] text-pub-upl">{info}</p>}

      <Submit intent="verify" idle="Verify & create account" busy="Checking…" />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px]">
        <button
          type="submit"
          name="intent"
          value="resend"
          formNoValidate
          disabled={left > 0}
          className="text-pub-cream underline decoration-pub-accent decoration-2 underline-offset-4 disabled:cursor-not-allowed disabled:text-pub-dim disabled:no-underline"
        >
          {left > 0 ? `Resend code in ${left}s` : "Resend code"}
        </button>
        <button type="submit" name="intent" value="restart" formNoValidate className="text-pub-muted hover:text-pub-cream">
          Use a different email
        </button>
      </div>
    </>
  );
}

export default function SignupForm() {
  const [state, action] = useActionState<FormState, FormData>(signup, { step: "details" });
  return (
    <form action={action} className="mt-9">
      {state.step === "code" ? (
        // keyed so the resend countdown restarts whenever a new code is sent
        <Code key={`${state.email}-${state.info ?? ""}`} email={state.email} error={state.error} info={state.info} />
      ) : (
        <Details error={state.error} />
      )}
    </form>
  );
}
