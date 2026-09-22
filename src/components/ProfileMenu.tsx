"use client";

import { useEffect, useRef, useState } from "react";
import type { Account } from "@/lib/types";
import { logout } from "@/app/login/actions";

/**
 * Avatar with a small popover: who is signed in, which broker, and the way
 * out. Sign-out posts to a Server Action so the httpOnly cookie is cleared
 * server-side — there is nothing for client JS to clear.
 *
 * Balances are deliberately absent until a broker is connected. An em dash is
 * honest; a zero would not be.
 */
export default function ProfileMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const initials = account.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
        aria-label={`Account — ${account.name}`}
        className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-violetsoft text-[12px] font-semibold text-violet transition-opacity hover:opacity-85"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-violetsoft text-[13px] font-semibold text-violet">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">{account.name}</p>
              <p className="truncate text-[11.5px] text-ink3">{account.email}</p>
            </div>
          </div>

          <dl className="space-y-2 border-b border-line px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[12.5px] text-ink3">Broker</dt>
              <dd className="text-[12.5px] font-medium text-ink">{account.broker}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[12.5px] text-ink3">Balance</dt>
              <dd className="tnum text-[12.5px] font-medium text-ink3">
                {account.balance === null ? "—" : account.balance}
              </dd>
            </div>
          </dl>

          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[13.5px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
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
