"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

/**
 * The admin console's left navigation: an ink panel (its own `side*` colour
 * tokens, the same in both themes), one page per item, the current one marked
 * with an accent bar. On small screens it folds into a "Menu" button.
 */

type Item = { label: string; href: string; icon: ReactNode; live?: boolean };

const I = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Overview",
    items: [{ label: "Dashboard", href: "/admin", icon: I("M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z") }],
  },
  {
    title: "Clients",
    items: [
      { label: "Accounts", href: "/admin/accounts", icon: I("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8") },
      { label: "Identity verification", href: "/admin/kyc", icon: I("M9 12l2 2 4-4M12 2l7 4v6c0 5-3.5 9-7 10-3.5-1-7-5-7-10V6z") },
      { label: "Members", href: "/admin/members", icon: I("M12 2l3 6 6 1-4.5 4.4 1 6.6L12 17l-5.5 3 1-6.6L3 9l6-1z") },
      { label: "Consent audit", href: "/admin/consents", icon: I("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4") },
      { label: "Admin access log", href: "/admin/access", icon: I("M12 8v4l3 3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z") },
    ],
  },
  {
    title: "Trading",
    items: [
      { label: "Live trading", href: "/admin/live", icon: I("M13 2L3 14h9l-1 8 10-12h-9l1-8z"), live: true },
      { label: "Order addresses", href: "/admin/addresses", icon: I("M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z") },
      { label: "Order log", href: "/admin/orders", icon: I("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01") },
      { label: "Fee ledger", href: "/admin/fees", icon: I("M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6") },
    ],
  },
  {
    title: "Research",
    items: [
      { label: "Paper trading", href: "/admin/paper", icon: I("M3 17l6-6 4 4 8-8M14 7h7v7"), live: true },
      { label: "Daily report", href: "/admin/paper/report", icon: I("M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6") },
      { label: "Scalping", href: "/admin/scalping", icon: I("M13 2L4 14h7l-1 8 9-12h-7z") },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (href === "/admin/paper") return pathname === "/admin/paper";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AdminNav() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const panel = (
    <div className="flex h-full flex-col rounded-xl bg-side text-sidetext" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="border-b border-sideline px-4 py-3.5">
        <p className="font-mono text-[10.5px] tracking-[0.1em] text-sidemuted uppercase">MNHA · console</p>
        <p className="mt-0.5 text-[13.5px] font-semibold">Admin</p>
      </div>
      <nav aria-label="Admin sections" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-1.5 px-2.5 font-mono text-[10px] tracking-[0.1em] text-sidemuted uppercase">{g.title}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const active = isActive(pathname, it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg py-2 pr-2.5 pl-3 text-[13px] transition-colors ${
                        active ? "bg-sideactive font-semibold text-sidetext" : "text-sidetext/80 hover:bg-sidehover hover:text-sidetext"
                      }`}
                    >
                      {active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-sideaccent" aria-hidden="true" />}
                      <span className={`shrink-0 ${active ? "text-sideaccent" : "text-sidemuted group-hover:text-sidetext"}`}>{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.live && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.08em] text-up uppercase" title="Running on live market data">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-up" />
                          </span>
                          live
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-sideline px-4 py-3 text-[11px] leading-snug text-sidemuted">
        Broker keys are encrypted and never shown here. Live trading sends real orders to clients&apos; Groww accounts.
      </div>
    </div>
  );
  return (
    <>
      <aside className="sticky top-[72px] hidden h-[calc(100vh-96px)] w-60 shrink-0 lg:block">{panel}</aside>
      <div className="mb-4 w-full lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-9 items-center gap-2 rounded-lg bg-side px-3 text-[12.5px] font-medium text-sidetext"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
          {open ? "Close" : "Menu"}
        </button>
        {open && <div className="mt-3 h-[70vh]">{panel}</div>}
      </div>
    </>
  );
}
