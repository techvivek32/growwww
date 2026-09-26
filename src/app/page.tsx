import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "MNHA Financials — a professional NSE terminal on your Groww account",
  description:
    "Live balance, holdings, positions and the full option chain from your own Groww account, with both-side trade setups scored by a real backtest. Decision-support, not investment advice.",
  // The landing is public and safe to index (unlike the gated terminal).
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
};

/* ------------------------------------------------------------------ bits */

function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="grid h-9 w-9 place-items-center rounded-xl"
        style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
        </svg>
      </span>
      <span className="leading-none">
        <span className={`block text-[16px] font-bold tracking-tight ${light ? "text-white" : "text-ink"}`}>MNHA</span>
        <span className={`block text-[9px] font-semibold tracking-[0.16em] ${light ? "text-white/70" : "text-ink3"}`}>
          FINANCIALS
        </span>
      </span>
    </span>
  );
}

function Feature({ title, body, icon }: { title: string; body: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-brandsoft text-brandtext">{icon}</div>
      <h3 className="mt-3.5 text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink3">{body}</p>
    </div>
  );
}

const I = {
  chart: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg>,
  layers: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5" /></svg>,
  pulse: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>,
  shield: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3ZM9.5 12l1.8 1.8L15 10" /></svg>,
  bolt: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" /></svg>,
  list: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>,
};

const FAQ = [
  {
    q: "Is this a broker? Where does my money sit?",
    a: "No. MNHA is a terminal that connects to your own Groww account through Groww's official trading API. Your money and your positions never leave Groww. Every order is placed on your account, and you confirm each one in two steps.",
  },
  {
    q: "Is this investment advice?",
    a: "No. It is decision-support tooling. The setups are mechanical rules read off real price and volume data, shown with their measured track record — not personalised advice, and not a recommendation to buy or sell. You place your trades, you own them.",
  },
  {
    q: "What returns should I expect?",
    a: "No guaranteed returns — from us or anyone. Trading is risky and most active traders lose money after costs. We show each setup's real, backtested win rate and expectancy, including a simulation with brokerage and taxes, precisely so you can judge for yourself instead of trusting a promise.",
  },
  {
    q: "How do prices and signals stay live?",
    a: "Prices come from the exchange feed via Groww, pushed to the screen sub-second. Setups are recomputed off real candles and each one's outcome is tracked live, so a setup that stops working is retired automatically.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-dvh bg-bg text-ink">
      {/* public nav */}
      <header className="app-header sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center gap-4 px-5">
          <Link href="/" aria-label="MNHA Financials home"><Wordmark /></Link>
          <nav className="ml-auto hidden items-center gap-7 text-[13.5px] font-medium text-ink2 md:flex">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
          <Link
            href="/login"
            className="ml-auto inline-flex h-9 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-surfaceh md:ml-6"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white transition-colors hover:bg-brandh"
          >
            Get started
          </Link>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
          style={{ background: "radial-gradient(60% 50% at 70% 0%, #00d09c 0%, transparent 60%), radial-gradient(50% 50% at 10% 20%, #5367ff 0%, transparent 55%)" }}
          aria-hidden="true"
        />
        <div className="mx-auto max-w-[1180px] px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink2">
            <span className="h-1.5 w-1.5 rounded-full bg-up live-dot" />
            Live on the NSE, on your own Groww account
          </span>
          <h1 className="mt-5 max-w-3xl text-[38px] leading-[1.08] font-bold tracking-[-0.03em] sm:text-[56px]">
            A professional trading terminal,
            <br className="hidden sm:block" />
            <span className="text-brandtext"> on the broker you already use.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-ink2">
            Connect your Groww account and get a live desk: balance, holdings, positions and the full option
            chain — plus both-side trade setups scored by a real backtest, not a promise. You keep your broker;
            you upgrade the cockpit.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="inline-flex h-12 items-center rounded-xl bg-brand px-6 text-[15px] font-semibold text-white transition-colors hover:bg-brandh">
              Get started — connect Groww
            </Link>
            <a href="#features" className="inline-flex h-12 items-center rounded-xl border border-line2 px-6 text-[15px] font-semibold text-ink transition-colors hover:bg-surfaceh">
              See what&apos;s inside
            </a>
          </div>
          <p className="mt-4 text-[12.5px] text-ink3">
            Decision-support tooling — not investment advice. Trading is risky; you place and own every order.
          </p>
        </div>
      </section>

      {/* trust strip */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-px px-5 sm:grid-cols-4">
          {[
            ["13", "setups, both sides"],
            ["Real", "backtest on live candles"],
            ["Sub-second", "exchange prices"],
            ["Your account", "orders you confirm"],
          ].map(([big, small]) => (
            <div key={small} className="px-2 py-7 text-center">
              <p className="text-[24px] font-bold tracking-tight text-ink">{big}</p>
              <p className="mt-0.5 text-[12.5px] text-ink3">{small}</p>
            </div>
          ))}
        </div>
      </section>

      {/* features */}
      <section id="features" className="mx-auto max-w-[1180px] scroll-mt-24 px-5 py-16 sm:py-20">
        <h2 className="text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">Everything the desk needs, in one screen.</h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink2">
          Built on Groww&apos;s official trading API, so the data is your real account and the orders are real orders.
        </p>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature icon={I.chart} title="Live account terminal" body="Balance, holdings, positions and today's order book, read straight from your Groww account and priced live." />
          <Feature icon={I.layers} title="Full option chain" body="NIFTY, BANKNIFTY, FINNIFTY, SENSEX and BANKEX — real strikes, premiums and open interest, with a docked order ticket." />
          <Feature icon={I.pulse} title="Signals that score themselves" body="Thirteen setups, long and short, each with a measured backtest edge and a live track record. Ones that stop paying retire on their own." />
          <Feature icon={I.chart} title="Backtest simulation" body="Trade any setup on ₹1,00,000 across years of real candles — with brokerage, STT and slippage charged, so the number is honest." />
          <Feature icon={I.list} title="Watchlists & screener" body="Track any NSE stock or index, with 30-day trend, 1-day change, volume and a 52-week range at a glance." />
          <Feature icon={I.bolt} title="Real-time prices" body="Index and stock prices pushed sub-second from the exchange feed — the strip stays live while the market is open." />
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1180px] scroll-mt-24 px-5 py-16 sm:py-20">
          <h2 className="text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">Live in four steps.</h2>
          <div className="mt-9 grid gap-6 md:grid-cols-4">
            {[
              ["Create your account", "Sign up with an email and password — your login to the terminal."],
              ["Connect Groww", "Add your own Groww trading-API key. It is encrypted and only ever used to read your account and place orders you confirm."],
              ["See your desk", "Your balance, holdings, positions, order book and the option chain, all live."],
              ["Trade with intent", "Signals arrive both-side, scored. Place any order in a deliberate two-step confirm — on your own account."],
            ].map(([t, b], idx) => (
              <div key={t}>
                <div className="grid h-9 w-9 place-items-center rounded-full bg-brand text-[14px] font-bold text-white">{idx + 1}</div>
                <h3 className="mt-4 text-[15.5px] font-semibold tracking-tight text-ink">{t}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink3">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* honesty */}
      <section className="mx-auto max-w-[1180px] px-5 py-16 sm:py-20">
        <div
          className="rounded-2xl border border-line bg-surface p-8 sm:p-11"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <span className="inline-flex items-center gap-2 rounded-full bg-warnsoft px-3 py-1.5 text-[12px] font-semibold text-warn">
            No promises
          </span>
          <h2 className="mt-4 max-w-2xl text-[26px] leading-tight font-bold tracking-[-0.02em] sm:text-[32px]">
            We show a measured edge, not a fantasy return.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink2">
            There is no zero-loss, 20%-a-month system — anywhere. SEBI&apos;s own study found roughly 9 in 10 F&amp;O
            traders lose money. So every number here is measured on real data and charged real costs, and the backtest
            page will happily show you when a setup does not clear those costs. That honesty is the point: you make
            informed decisions, and you keep control of every trade.
          </p>
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[820px] scroll-mt-24 px-5 py-16 sm:py-20">
          <h2 className="text-[28px] font-bold tracking-[-0.02em] sm:text-[34px]">Questions, answered straight.</h2>
          <div className="mt-8 divide-y divide-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-semibold text-ink">
                  {f.q}
                  <svg className="shrink-0 text-ink3 transition-transform group-open:rotate-45" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-ink2">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1180px] px-5 py-16 sm:py-20">
        <div className="relative overflow-hidden rounded-2xl px-8 py-12 text-center sm:px-12 sm:py-16" style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}>
          <h2 className="text-[28px] font-bold tracking-[-0.02em] text-white sm:text-[36px]">Bring your Groww account to life.</h2>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/90">
            Sign in, connect your broker, and trade from a terminal that tells you the truth about its own edge.
          </p>
          <Link href="/login" className="mt-7 inline-flex h-12 items-center rounded-xl bg-white px-7 text-[15px] font-semibold text-ink transition-transform hover:scale-[1.02]">
            Get started
          </Link>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Wordmark />
            <div className="flex gap-6 text-[13px] font-medium text-ink2">
              <a href="#features" className="hover:text-ink">Features</a>
              <a href="#how" className="hover:text-ink">How it works</a>
              <a href="#faq" className="hover:text-ink">FAQ</a>
              <Link href="/login" className="hover:text-ink">Sign in</Link>
            </div>
          </div>
          <p className="mt-8 max-w-3xl text-[11.5px] leading-relaxed text-ink3">
            MNHA Financials is a decision-support terminal, not a broker and not an investment adviser. It is not
            registered with SEBI as a Research Analyst or Investment Adviser, and nothing here is a recommendation to
            buy or sell any security. Setups are generated from price and volume data and can be wrong. Trading in
            equities and derivatives carries risk of loss. Orders you confirm are placed on your own Groww account
            through Groww&apos;s official API — you place them, you own them. &ldquo;Groww&rdquo; is a trademark of its
            respective owner; MNHA Financials is an independent tool and is not affiliated with or endorsed by it.
          </p>
          <p className="mt-5 text-[11.5px] text-ink3">© {new Date().getFullYear()} MNHA Financials. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
