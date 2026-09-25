"use client";

import { useFormStatus } from "react-dom";
import { refreshSignalsAction } from "@/app/(app)/stocks/alerts/actions";

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-surfaceh hover:text-ink disabled:opacity-60"
    >
      <svg
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        className={pending ? "animate-spin" : ""}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
      </svg>
      {pending ? "Scanning…" : "Run scan now"}
    </button>
  );
}

export default function RefreshSignals() {
  return (
    <form action={refreshSignalsAction}>
      <Btn />
    </form>
  );
}
