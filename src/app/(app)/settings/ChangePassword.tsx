"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, type PwState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="mt-1 inline-flex h-10 items-center bg-brand px-4 text-[13.5px] font-semibold text-onbrand transition-colors hover:bg-brandh disabled:opacity-60">
      {pending ? "Saving…" : "Update password"}
    </button>
  );
}

const field = "block h-10 w-full max-w-sm border border-line2 bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-ink3 focus:border-ink";

export default function ChangePassword() {
  const [state, action] = useActionState<PwState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-3">
      <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" aria-label="Current password" className={field} />
      <input name="next" type="password" required minLength={8} autoComplete="new-password" placeholder="New password (8+ chars)" aria-label="New password" className={field} />
      <input name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm new password" aria-label="Confirm new password" className={field} />
      {state.error && <p role="alert" className="text-[12.5px] text-down">{state.error}</p>}
      {state.ok && <p role="status" className="text-[12.5px] text-up">Password updated.</p>}
      <div><Submit /></div>
    </form>
  );
}
