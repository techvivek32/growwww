"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

/**
 * The admin console's left navigation. Page links highlight by route; the
 * dashboard's sections are in-page anchors. On small screens it folds into a
 * "Menu" button under the header.
 */

const GROUPS: { title: string; items: { label: string; href: string; hint?: string }[] }[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/admin" },
      { label: "Onboarding funnel", href: "/admin#funnel" },
      { label: "Signal engine", href: "/admin#signals" },
    ],
  },
  {
    title: "Clients",
    items: [
      { label: "Accounts", href: "/admin#accounts" },
      { label: "Identity verification", href: "/admin#kyc" },
      { label: "Members", href: "/admin#members" },
      { label: "Consent audit", href: "/admin#consents" },
      { label: "Admin access log", href: "/admin#access" },
    ],
  },
  {
    title: "Trading",
    items: [
      { label: "Order addresses", href: "/admin#addresses" },
      { label: "Order log", href: "/admin#orders" },
      { label: "Fee ledger", href: "/admin#fees" },
    ],
  },
  {
    title: "Research",
    items: [
      { label: "Paper trading", href: "/admin/paper", hint: "live" },
      { label: "Daily report", href: "/admin/paper/report" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  const base = href.split("#")[0];
  if (href.includes("#")) return false;
  return base === "/admin" ? pathname === "/admin" : pathname === base || pathname.startsWith(base + "/");
}

export default function AdminNav() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const nav = (
    <nav aria-label="Admin sections" className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-2 font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((it) => {
              const active = isActive(pathname, it.href);
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      active ? "bg-surface2 font-semibold text-ink" : "text-ink2 hover:bg-surfaceh hover:text-ink"
                    }`}
                  >
                    <span>{it.label}</span>
                    {it.hint && (
                      <span className="ml-2 inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.06em] text-up uppercase">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-up" aria-hidden="true" />
                        {it.hint}
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
  );
  return (
    <>
      <aside className="sticky top-[72px] hidden h-[calc(100vh-88px)] w-56 shrink-0 overflow-y-auto pr-4 lg:block">{nav}</aside>
      <div className="mb-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex h-9 items-center gap-2 border border-line2 px-3 text-[12.5px] font-medium text-ink2 hover:bg-surfaceh hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          Menu
        </button>
        {open && <div className="mt-3 rounded-xl border border-line bg-surface p-3">{nav}</div>}
      </div>
    </>
  );
}
