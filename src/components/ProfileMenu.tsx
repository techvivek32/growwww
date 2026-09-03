"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOUNT } from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct } from "@/lib/format";
import { logout } from "@/app/login/actions";

/**
 * Avatar with a small popover: who is signed in, the account line, and the
 * way out. Sign-out posts to a Server Action so the httpOnly cookie is
 * cleared server-side — there is nothing for client JS to clear.
 */
export default function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account — ${ACCOUNT.name}`}
        className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-violetsoft text-[12px] font-semibold text-violet transition-opacity hover:opacity-85"
      >
        {ACCOUNT.initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violetsoft text-[13px] font-semibold text-violet">
              {ACCOUNT.initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">{ACCOUNT.name}</p>
              <p className="truncate text-[11.5px] text-ink3">{ACCOUNT.email}</p>
            </div>
          </div>

          <dl className="space-y-2 border-b border-line px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[12px] text-ink3">Balance</dt>
              <dd className="tnum text-[12.5px] font-semibold text-ink">{fmtMoney(ACCOUNT.balance)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[12px] text-ink3">Realised P&amp;L</dt>
              <dd className="tnum text-[12.5px] font-semibold text-up">
                {fmtMoneySigned(ACCOUNT.netPnl, 0)} ({fmtPct(ACCOUNT.returnPct)})
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[12px] text-ink3">Broker</dt>
              <dd className="text-[12.5px] font-medium text-ink">{ACCOUNT.broker} · paper</dd>
            </div>
          </dl>

          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[13px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
