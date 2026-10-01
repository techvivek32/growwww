"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { adminSettleMember, type SettleState } from "./actions";

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 bg-brand px-3 text-[12px] font-semibold text-onbrand transition-colors hover:bg-brandh disabled:opacity-60"
    >
      {pending ? "Reading live NAV…" : "Settle now (reads live NAV)"}
    </button>
  );
}

/** One member's settle control. `ended` = the period's scheduled end has passed. */
export default function SettleForm({ userId, periodEndsAt, ended }: { userId: string; periodEndsAt: number; ended: boolean }) {
  const [state, action] = useActionState<SettleState, FormData>(adminSettleMember, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="periodEndsAt" value={periodEndsAt} />
      {ended ? <Btn /> : <span className="text-[11.5px] text-ink3">Settles after the period ends</span>}
      {state.error && <p role="alert" className="basis-full text-[11.5px] text-down">{state.error}</p>}
      {state.ok && <p role="status" className="basis-full text-[11.5px] text-up">{state.ok}</p>}
    </form>
  );
}
