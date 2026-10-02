"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import type { Account } from "@/lib/types";
import ThemeToggle from "./ThemeToggle";
import MarketClock from "./MarketClock";
import { AutoTradeToggle } from "./AutoTrade";
import ProfileMenu from "./ProfileMenu";
import SearchBox from "./SearchBox";
import { LogoMark, Wordmark } from "./public/Brand";
import { MEMBER_HOME, OWNER_HOME } from "@/lib/routes";

function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex shrink-0 items-center text-ink" aria-label="MNHA Financials home">
      <span className="sm:hidden">
        <LogoMark tone="current" />
      </span>
      <span className="hidden sm:inline-flex">
        <Wordmark tone="current" />
      </span>
    </Link>
  );
}

function BellLink({ unread, active }: { unread: number; active: boolean }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className={`relative grid h-9 w-9 place-items-center transition-colors hover:bg-surfaceh ${active ? "text-ink" : "text-ink2 hover:text-ink"}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-down px-1 text-[9px] font-bold text-onbrand">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}

export default function TopNav({
  account,
  connected,
  isOwner = false,
  unread = 0,
}: {
  account: Account;
  connected: boolean;
  isOwner?: boolean;
  unread?: number;
}) {
  const pathname = usePathname();
  // Member accounts see only view-only sections — no signals, alerts or order entry.
  const visible = NAV_ITEMS.filter((i) => isOwner || i.access !== "owner");
  const trading = visible.filter((i) => i.group === "trading");
  const system = visible.filter((i) => i.group === "system");

  const tab = (i: (typeof NAV_ITEMS)[number], dim = false) => {
    const on = pathname === i.href;
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={on ? "page" : undefined}
        className={`relative shrink-0 px-2.5 py-3 text-[13.5px] font-medium whitespace-nowrap transition-colors ${
          on ? "text-ink" : dim ? "text-ink3 hover:text-ink2" : "text-ink2 hover:text-ink"
        }`}
      >
        <span className="2xl:hidden">{i.short ?? i.label}</span>
        <span className="hidden 2xl:inline">{i.label}</span>
        {on && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-mark" />}
      </Link>
    );
  };

  return (
    <header className="app-header sticky top-0 z-40">
      {/* Row 1 — brand, search, account */}
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-4 px-4 lg:px-6">
        <Logo href={isOwner ? OWNER_HOME : MEMBER_HOME} />


        <div className="ml-auto hidden min-w-0 flex-1 justify-center lg:flex">
          <SearchBox />
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-2 lg:ml-0">
          <span className="hidden lg:block">
            <MarketClock />
          </span>
          {isOwner && <AutoTradeToggle />}
          <BellLink unread={unread} active={pathname === "/notifications"} />
          <ThemeToggle />
          <ProfileMenu account={account} />
        </div>
      </div>

      {/* Row 2 — every section, exactly as NOVA listed them */}
      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1360px] items-center gap-2 px-4 lg:px-6">
          <nav className="no-bar flex min-w-0 flex-1 items-center overflow-x-auto" aria-label="Sections">
            {trading.map((i) => tab(i))}
            <span className="mx-2 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
            {system.map((i) => tab(i, true))}
          </nav>

          <div className="hidden shrink-0 items-center 2xl:flex">
            <Link
              href="/broker"
              className="flex items-center gap-1.5 border border-line px-2.5 py-1.5 font-mono text-[11px] tracking-[0.04em] text-ink2 uppercase transition-colors hover:bg-surfaceh hover:text-ink"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-up" : "bg-ink3"}`} />
              {account.broker}
              {!connected && <span className="text-ink3">· not connected</span>}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
