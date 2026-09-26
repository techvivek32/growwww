"use client";

import { useEffect } from "react";

/**
 * App-level error boundary. Renders when a page throws at runtime — the viewer
 * gets a calm recovery screen instead of a broken page, and can retry without a
 * full reload.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <div className="grid min-h-[70vh] place-items-center px-5 text-center">
      <div>
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-downsoft text-down">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="mt-3 text-[20px] font-semibold tracking-tight text-ink">Something went wrong</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink3">
          This screen hit an error and stopped. Your account and orders are unaffected — nothing here places or cancels
          anything on its own. Try again, and check Groww directly for anything time-sensitive.
        </p>
        {error.digest && <p className="tnum mt-2 text-[11px] text-ink3">ref {error.digest}</p>}
        <button
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand px-5 text-[14px] font-semibold text-white hover:bg-brandh"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
