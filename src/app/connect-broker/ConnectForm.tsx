"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { connectBroker, type FormState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 flex h-12 w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white transition-colors hover:bg-brandh disabled:opacity-60"
    >
      {pending ? "Verifying with Groww…" : "Connect & verify"}
    </button>
  );
}

const field =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink3 focus:border-brand";

export default function ConnectForm() {
  const [state, action] = useActionState<FormState, FormData>(connectBroker, {});
  return (
    <form action={action} className="mt-6">
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Groww API key</span>
        <textarea name="apiKey" required rows={3} placeholder="Paste your Groww trading-API key" className={`${field} resize-none font-mono text-[12px] leading-relaxed`} />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[12px] font-semibold text-ink2">TOTP secret</span>
        <input name="totpSecret" required placeholder="The TOTP secret from your Groww API setup" className={`${field} font-mono`} autoComplete="off" spellCheck={false} />
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
