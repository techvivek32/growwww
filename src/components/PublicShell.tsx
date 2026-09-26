import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The chrome for public pages that are not the landing itself — legal, contact,
 * and the like. Same header and footer as the landing so the marketing surface
 * reads as one site, without pulling in the authed terminal chrome.
 */

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16.5 9.5 11l3.5 3.5L20 7" /></svg>
      </span>
      <span className="leading-none">
        <span className="block text-[16px] font-bold tracking-tight text-ink">MNHA</span>
        <span className="block text-[9px] font-semibold tracking-[0.16em] text-ink3">FINANCIALS</span>
      </span>
    </span>
  );
}

const LEGAL = [
  ["/legal/terms", "Terms"],
  ["/legal/privacy", "Privacy"],
  ["/legal/risk-disclosure", "Risk disclosure"],
  ["/legal/contact", "Contact"],
];

export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      <header className="app-header sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-4 px-5">
          <Link href="/" aria-label="MNHA Financials home"><Wordmark /></Link>
          <Link href="/login" className="ml-auto inline-flex h-9 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-surfaceh">Sign in</Link>
          <Link href="/signup" className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-brandh">Get started</Link>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-5 py-12 sm:py-16">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Wordmark />
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-ink2">
              {LEGAL.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-ink">{label}</Link>
              ))}
            </div>
          </div>
          <p className="mt-6 text-[11.5px] leading-relaxed text-ink3">
            MNHA Financials is a decision-support terminal, not a broker and not an investment adviser. It is not
            registered with SEBI as a Research Analyst or Investment Adviser. Nothing here is a recommendation to buy
            or sell any security. Trading carries risk of loss. &ldquo;Groww&rdquo; is a trademark of its respective
            owner; MNHA Financials is independent and not affiliated with or endorsed by it.
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Shared article styling for the legal prose. */
export function LegalArticle({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article>
      <Link href="/" className="text-[13px] font-medium text-brandtext hover:opacity-75">← Back to home</Link>
      <h1 className="mt-4 text-[30px] font-bold tracking-[-0.02em] text-ink sm:text-[36px]">{title}</h1>
      <p className="mt-2 text-[12.5px] text-ink3">Last updated {updated}</p>
      <div className="legal mt-8 space-y-6 text-[14px] leading-relaxed text-ink2">{children}</div>
    </article>
  );
}
