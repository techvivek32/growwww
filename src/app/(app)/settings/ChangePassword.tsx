"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction, type PwState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="mt-2 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white hover:bg-brandh disabled:opacity-60">
      {pending ? "Saving…" : "Update password"}
    </button>
  );
}

const field = "h-10 w-full max-w-xs rounded-lg border border-line bg-surface px-3 text-[13.5px] text-ink outline-none focus:border-brand";

export default function ChangePassword() {
  const [state, action] = useActionState<PwState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-3">
      <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" className={field} />
      <input name="next" type="password" required minLength={8} autoComplete="new-password" placeholder="New password (8+ chars)" className={field} />
      <input name="confirm" type="password" required minLength={8} autoComplete="new-password" placeholder="Confirm new password" className={field} />
      {state.error && <p role="alert" className="text-[12.5px] text-down">{state.error}</p>}
      {state.ok && <p className="text-[12.5px] text-up">Password updated.</p>}
      <div><Submit /></div>
    </form>
  );
}
