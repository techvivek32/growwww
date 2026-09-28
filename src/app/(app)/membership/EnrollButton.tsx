"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { enrollAction, type MemberState } from "./actions";

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="inline-flex h-11 items-center justify-center rounded-lg bg-brand px-6 text-[14.5px] font-semibold text-white hover:bg-brandh disabled:opacity-60">
      {pending ? "Starting…" : "Start membership"}
    </button>
  );
}

export default function EnrollButton() {
  const [state, action] = useActionState<MemberState, FormData>(enrollAction, {});
  return (
    <form action={action}>
      <Btn />
      {state.error && <p role="alert" className="mt-2 text-[12.5px] text-down">{state.error}</p>}
    </form>
  );
}
