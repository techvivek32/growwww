"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/nav";
import type { Account } from "@/lib/types";
import ThemeToggle from "./ThemeToggle";
import MarketClock from "./MarketClock";
import { AutoTradeToggle } from "./AutoTrade";
import ProfileMenu from "./ProfileMenu";

function Logo() {
  return (
    <Link href="/stocks/alerts" className="flex shrink-0 items-center gap-2.5" aria-label="MNHA Financials home">
      <span
        className="grid h-9 w-9 place-items-center rounded-full"
        style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
        </svg>
      </span>
      <span className="hidden leading-none sm:block">
        <span className="block text-[16px] font-bold tracking-tight text-ink">MNHA</span>
        <span className="block text-[9px] font-semibold tracking-[0.16em] text-ink3">FINANCIALS</span>
      </span>
    </Link>
  );
}

export default function TopNav({ account, connected }: { account: Account; connected: boolean }) {
  const pathname = usePathname();
  const trading = NAV_ITEMS.filter((i) => i.group === "trading");
  const system = NAV_ITEMS.filter((i) => i.group === "system");

  const tab = (i: (typeof NAV_ITEMS)[number], dim = false) => {
    const on = pathname === i.href;
    return (
      <Link
        key={i.href}
        href={i.href}
        aria-current={on ? "page" : undefined}
        className={`relative shrink-0 px-3 py-3 text-[13.5px] font-medium whitespace-nowrap transition-colors ${
          on ? "text-ink" : dim ? "text-ink3 hover:text-ink2" : "text-ink2 hover:text-ink"
        }`}
      >
        <span className="lg:hidden">{i.short ?? i.label}</span>
        <span className="hidden lg:inline">{i.label}</span>
        {on && <span className="absolute inset-x-2 bottom-0 h-[2.5px] rounded-full bg-brand" />}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 bg-surface">
      {/* Row 1 — brand, search, account */}
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-4 px-4 lg:px-6">
        <Logo />


        <div className="ml-auto flex shrink-0 items-center gap-2">
          <MarketClock />
          <AutoTradeToggle />
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

          <div className="hidden shrink-0 items-center xl:flex">
            <Link
              href="/broker"
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
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
