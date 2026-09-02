"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTIONS, sectionForPath } from "@/lib/nav";
import { ACCOUNT } from "@/lib/mock";
import { fmtMoney } from "@/lib/format";
import ThemeToggle from "./ThemeToggle";
import MarketClock from "./MarketClock";

function Logo() {
  return (
    <Link href="/stocks/alerts" className="flex shrink-0 items-center gap-2.5" aria-label="NOVA India home">
      <span
        className="grid h-8 w-8 place-items-center rounded-full"
        style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
        </svg>
      </span>
      <span className="hidden leading-none sm:block">
        <span className="block text-[16px] font-bold tracking-tight text-ink">NOVA</span>
        <span className="block text-[9px] font-semibold tracking-[0.18em] text-ink3">INDIA</span>
      </span>
    </Link>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const active = sectionForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-6 px-4 lg:px-6">
        <Logo />

        {/* Primary sections — Groww's Stocks / F&O / Mutual Funds row */}
        <nav className="no-bar flex items-center gap-1 overflow-x-auto" aria-label="Primary">
          {SECTIONS.map((s) => {
            const on = active?.key === s.key;
            return (
              <Link
                key={s.key}
                href={s.href}
                aria-current={on ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-[15px] font-medium whitespace-nowrap transition-colors ${
                  on ? "text-ink" : "text-ink2 hover:text-ink"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>

        {/* Search — Groww's centred pill */}
        <div className="ml-auto hidden min-w-0 flex-1 justify-center lg:flex">
          <label className="flex h-10 w-full max-w-[380px] items-center gap-2 rounded-lg border border-line bg-surface2 px-3 focus-within:border-brand">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink3">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              placeholder="Search NSE stocks, F&O…"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink3"
            />
            <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink3 xl:block">
              Ctrl K
            </kbd>
          </label>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
          <MarketClock />
          <ThemeToggle />
          <button
            type="button"
            aria-label="Notifications"
            className="grid h-9 w-9 place-items-center rounded-full text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
              <path d="M10.3 20a2 2 0 0 0 3.4 0" />
            </svg>
          </button>
          <span
            className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-violetsoft text-[12px] font-semibold text-violet"
            title={ACCOUNT.name}
          >
            VV
          </span>
        </div>
      </div>

      {/* Sub-tabs for the active section */}
      {active && (
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-[1360px] items-center gap-1 px-4 lg:px-6">
            <nav className="no-bar flex flex-1 items-center gap-1 overflow-x-auto" aria-label={active.label}>
              {active.tabs.map((t) => {
                const on = pathname === t.href;
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={on ? "page" : undefined}
                    className={`relative px-3 py-3 text-[14px] font-medium whitespace-nowrap transition-colors ${
                      on ? "text-ink" : "text-ink3 hover:text-ink2"
                    }`}
                  >
                    {t.label}
                    {on && <span className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-brand" />}
                  </Link>
                );
              })}
            </nav>

            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <span className="tnum text-[13px] text-ink3">
                Balance <strong className="font-semibold text-ink">{fmtMoney(ACCOUNT.balance)}</strong>
              </span>
              <Link
                href="/settings"
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-warn" />
                Paper mode
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
