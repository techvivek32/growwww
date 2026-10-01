import type { Metadata } from "next";
import Link from "next/link";
import { getPublicTape } from "@/lib/publicTape";
import { STRATEGIES } from "@/lib/signals/strategies";
import { scorecards } from "@/lib/signals/engine";
import { DEFAULT_FEE_PCT, DEFAULT_PERIOD_DAYS } from "@/lib/membership";
import { pubFonts } from "@/components/public/fonts";
import { LogoMark } from "@/components/public/Brand";
import SiteNav from "@/components/public/SiteNav";
import SiteFooter from "@/components/public/SiteFooter";
import WaveArt from "@/components/public/WaveArt";
import TickerCard from "@/components/public/TickerCard";
import RiskCalculator from "@/components/public/RiskCalculator";
import { Arrow, Button, Container, Display, Eyebrow, Mono, TextLink } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "MNHA Financials — a live NSE desk on your own Groww account",
  description:
    "Connect your Groww account and trade from a desk that is honest about risk: live balance, positions and option chains, with both-side setups backtested on real NSE candles — winners and losers shown alike. Decision-support, not investment advice.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
};

// The tape is live market data (cached 30s in-process), so render per request.
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------- glyphs */

const G = {
  vault: (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="currentColor" aria-hidden="true">
      <path d="M6 8h36v28H6zM10 36h6v4h-6zM32 36h6v4h-6z" />
      <circle cx="24" cy="22" r="7" fill="#26231c" />
      <circle cx="24" cy="22" r="3" />
    </svg>
  ),
  bars: (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="currentColor" aria-hidden="true">
      <path d="M6 40h36v3H6zM9 26h7v12H9zM20.5 16h7v22h-7zM32 8h7v30h-7z" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="currentColor" aria-hidden="true">
      <path d="M17 8a11 11 0 1 0 9.6 16.4H32v5h5v-5h3v5h4v-9H26.6A11 11 0 0 0 17 8Zm-3 8a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" fillRule="evenodd" />
    </svg>
  ),
  scale: (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="currentColor" aria-hidden="true">
      <path d="M22.5 6h3v4.2l13 3.3-.7 2.9-1.9-.5L42 28a8 8 0 0 1-15 0l5.6-12.9-7.1-1.8V38H33v4H15v-4h7.5V13.3l-7.1 1.8L21 28a8 8 0 0 1-15 0l6.1-12.1-1.9.5-.7-2.9 13-3.3z" />
    </svg>
  ),
  peak: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M2 20 9 7l4 6 3-4 6 11z" />
      <path d="M15 2h6v2h-6z" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M12 2 4 5v6c0 5 3.4 8.6 8 11 4.6-2.4 8-6 8-11V5zM8 11h8v2H8z" fillRule="evenodd" />
    </svg>
  ),
  bank: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M12 2 2 7v2h20V7zM4 11h3v7H4zM10.5 11h3v7h-3zM17 11h3v7h-3zM2 20h20v2H2z" />
    </svg>
  ),
  door: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M4 2h11v20H4zM17 7l5 5-5 5v-3.5h-3v-3h3z" />
    </svg>
  ),
};

/* ------------------------------------------------------------ content */

const PATH: { n: string; title: string; body: string; rows: [string, string, string][] }[] = [
  {
    n: "01.",
    title: "Your account",
    body: "An email and a password, then the user agreement — in English, हिन्दी or ગુજરાતી, with a read-aloud option — and a short spoken acknowledgement on video.",
    rows: [
      ["1.1", "Create your MNHA login", "1 min"],
      ["1.2", "Read or listen to the agreement", "5 min"],
      ["1.3", "Selfie, photo ID and a spoken acknowledgement", "3 min"],
    ],
  },
  {
    n: "02.",
    title: "Connect Groww",
    body: "A guided wizard. You sign in to Groww on Groww's own site, create an API key there and paste it back. We verify it live with Groww before saving it, encrypted.",
    rows: [
      ["2.1", "Open Groww → Trading APIs", "1 min"],
      ["2.2", "Generate a TOTP key", "1 min"],
      ["2.3", "Add our server's static IP to the key", "1 min"],
      ["2.4", "Paste once — we recognise and verify it", "1 min"],
    ],
  },
  {
    n: "03.",
    title: "The desk",
    body: "Your desk opens on your own account. Setups arrive on both sides with their measured record, and nothing is sent to Groww until you confirm it.",
    rows: [
      ["3.1", "Balance, holdings and positions, live", "live"],
      ["3.2", "Setups with their backtest and live record", "live"],
      ["3.3", "Orders you confirm — twice", "you"],
    ],
  },
];

const FAQ: [string, string][] = [
  [
    "Is MNHA a broker? Where does my money sit?",
    "No. MNHA is software that connects to your own Groww account through Groww's official trading API. Your cash and shares never leave Groww, we hold no money, and an API key cannot withdraw funds. Every order is placed on your account, by you.",
  ],
  [
    "Do you ever see my Groww password?",
    "No — and we never ask for it, or for your PIN or an OTP. You sign in on Groww's own website, create an API key there, and paste only the key and its TOTP secret here. They are verified live, stored AES-256 encrypted, and you can revoke the key on Groww at any time.",
  ],
  [
    "Why do I add an IP address on my Groww key?",
    "Exchange rules for API trading require orders to come from a static IP address registered on the API key, and Groww rejects API orders from any other address. Orders from this desk leave from our server, so the wizard shows its address for you to add. Reading your account and market data does not depend on it.",
  ],
  [
    "What do I need before I start?",
    "A Groww account, an active Groww Trading API subscription (Groww sells this separately — check the current price on Groww), and about fifteen minutes. A phone camera helps for the agreement step.",
  ],
  [
    "What returns should I expect?",
    "Nobody can honestly promise a return, and we don't. Most active traders lose money after costs — SEBI's own studies found roughly 9 in 10 individual F&O traders lost money. We show every setup's measured win rate and expectancy on real candles — including the ones that don't work — plus a simulation of the main setup with brokerage, STT and slippage charged, so you can judge for yourself.",
  ],
  [
    "Is this investment advice?",
    "No. It is decision-support software. Setups are mechanical rules read off real price and volume data — not personalised advice and not a recommendation to buy or sell. You decide and place every trade.",
  ],
  [
    "What does it cost?",
    `There is no subscription fee for the desk at present. The membership is optional: a ${DEFAULT_FEE_PCT}% share of any rise in your account value above its previous peak, and no fee while it is below that peak. Groww's own brokerage, API subscription and statutory charges apply as usual.`,
  ],
  [
    "Can I leave and delete everything?",
    "Yes. Disconnect Groww or delete your account from Settings at any time. Deleting erases your stored keys, agreement media, verification files, order log and notifications here; membership invoices are kept as billing records. An active membership must be left first (that closes its period) and an unpaid invoice settled. Your Groww account is untouched — and you can also revoke the key on Groww.",
  ],
];

/* ------------------------------------------------------------- page */

async function activeCount(): Promise<number | null> {
  try {
    const cards = await scorecards();
    if (!cards.some((c) => c.backtest !== null)) return null; // edge not computed yet
    return cards.filter((c) => c.edge).length;
  } catch {
    return null;
  }
}

export default async function Landing() {
  const [tape, active] = await Promise.all([getPublicTape(), activeCount()]);
  const setups = STRATEGIES.length;

  const DESK: [string, string, string][] = [
    ["T/01", "Live account", "Balance, holdings, positions and today's order book, read straight from your Groww account."],
    ["T/02", "Option chains", "NIFTY, BANK NIFTY, FIN NIFTY, SENSEX and BANKEX — real strikes, premiums and open interest."],
    ["T/03", "Setups, both sides", `${setups} rule-based setups, long and short, each backtested on real NSE candles (before costs).`],
    ["T/04", "Backtest lab", "Every setup's record on years of real candles, plus a cost-charged simulation of the main setup — shown even when it doesn't pay."],
    ["T/05", "Live journal", "Every signal's outcome is tracked live; a setup whose edge fades is retired on its own."],
    ["T/06", "Watchlists & screener", "Any NSE stock or index with its trend, day change, volume and 52-week range."],
    ["T/07", "Order ticket", "Market, limit and stop orders with a two-step confirm and hard size limits."],
    ["T/08", "Alerts inbox", "Order, broker and account notifications, in one place."],
  ];

  const STATS: [string, string][] = [
    [String(setups), "Setups scored"],
    [active === null ? "—" : String(active), "Positive before costs"],
    ["2", "Taps to confirm"],
    ["₹0", "Held by us"],
  ];

  return (
    <div className={`pub ${pubFonts} min-h-dvh`}>
      <SiteNav />

      <main>
        {/* 1 · Hero */}
        <section className="relative overflow-hidden border-b border-pub-hair">
          <div className="absolute inset-y-0 right-0 left-[58%] hidden lg:block">
            <WaveArt variant="hero" uid="hero" />
          </div>
          <Container className="relative">
            <div className="pt-16 pb-14 sm:pt-20 lg:w-[52%] lg:pt-24 lg:pb-24">
              <p className="text-[12.5px] font-semibold tracking-[0.12em] text-pub-cream uppercase">
                A live NSE desk on your own Groww account
              </p>
              <Display as="h1" className="mt-7 text-[clamp(3.4rem,7.4vw,6.6rem)] leading-[0.95] text-pub-cream">
                <span className="block whitespace-nowrap">Measure</span>
                <span className="block whitespace-nowrap">the edge.</span>
                <span className="block whitespace-nowrap">Then take</span>
                <span className="block whitespace-nowrap">
                  the <em>trade.</em>
                </span>
              </Display>
              <p className="mt-8 max-w-[34rem] text-[18px] leading-[1.6] text-pub-muted">
                Connect your Groww account and trade from a desk that tells you the truth: live balance, positions and
                option chains, plus {setups} both-side setups backtested on real NSE candles — winners and losers shown
                alike. Your money never leaves Groww. No tips, no hype.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5">
                <Button href="/signup">Create your account</Button>
                <TextLink href="/#path">How connecting works</TextLink>
              </div>

              <dl className="mt-14 grid max-w-[36rem] grid-cols-2 border-t border-pub-cream sm:grid-cols-4">
                {STATS.map(([v, l], i) => (
                  <div
                    key={l}
                    className={`flex flex-col py-4 pr-3 ${i % 2 === 1 ? "border-l border-pub-hair pl-4" : ""} ${i >= 2 ? "sm:border-l sm:border-pub-hair sm:pl-4" : ""} ${i >= 2 ? "border-t border-pub-hair sm:border-t-0" : ""}`}
                  >
                    <dt className="order-2 mt-2 font-plex text-[10.5px] tracking-[0.1em] text-pub-muted uppercase">{l}</dt>
                    <dd className="tnum order-1 text-[30px] leading-none text-pub-cream">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Container>

          {/* ticker: straddles the art on desktop, sits on an art band on phones */}
          <div className="relative lg:hidden">
            <div className="relative h-72 sm:h-80">
              <WaveArt variant="hero" uid="hero-m" />
            </div>
            <div className="absolute inset-x-0 -top-10 flex justify-center px-4">
              <TickerCard tape={tape} />
            </div>
          </div>
          <div className="absolute bottom-12 left-[calc(58%+2rem)] z-10 hidden lg:block xl:left-[calc(58%-6rem)]">
            <TickerCard tape={tape} />
          </div>
        </section>

        {/* 2 · Manifesto */}
        <section className="bg-pub-ink2 py-24 sm:py-36">
          <Container className="text-center">
            <div className="flex justify-center">
              <LogoMark tone="art" size={30} />
            </div>
            <Display as="p" className="mx-auto mt-8 max-w-[50rem] text-[clamp(2.3rem,5vw,4rem)] leading-[1.05] text-pub-cream">
              Most trading apps are built to make you trade more. This one is built to show you the <em>odds.</em>
            </Display>
            <p className="mt-9 font-plex text-[11px] tracking-[0.12em] text-pub-muted uppercase">
              No guaranteed returns · No paid tips · Your money never leaves Groww
            </p>
          </Container>
        </section>

        {/* 3 · The path */}
        <section id="path" className="border-b border-pub-hair py-24 sm:py-32">
          <Container className="grid gap-14 lg:grid-cols-12">
            <div className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
              <Eyebrow n="01">How it works</Eyebrow>
              <Display className="mt-6 text-[clamp(2.4rem,4vw,3.4rem)] leading-[1.0] text-pub-cream">
                Three steps. One Groww account. About <em>fifteen minutes.</em>
              </Display>
              <p className="mt-6 text-[16px] leading-[1.6] text-pub-muted">
                Everything happens here except one thing: you sign in to Groww on Groww&apos;s own website. We never
                ask for — and never see — your Groww password, PIN or OTP.
              </p>
              <div className="mt-8">
                <TextLink href="/signup">Start step one</TextLink>
              </div>
            </div>

            <div className="lg:col-span-8">
              {PATH.map((m, i) => (
                <div key={m.n} className={`grid gap-6 sm:grid-cols-[8.5rem_1fr] ${i > 0 ? "mt-12 border-t border-pub-cream pt-12" : ""}`}>
                  <p className="tnum text-[56px] leading-none text-pub-cream sm:text-[72px]">{m.n}</p>
                  <div>
                    <p className="text-[12px] font-semibold tracking-[0.12em] text-pub-cream uppercase">{m.title}</p>
                    <p className="mt-3 max-w-[34rem] text-[16.5px] leading-[1.6] text-pub-muted">{m.body}</p>
                    <ul className="mt-7 border-t border-pub-hair">
                      {m.rows.map(([idx, title, dur]) => (
                        <li key={idx} className="flex items-center gap-5 border-b border-pub-hair py-4">
                          <span className="w-8 shrink-0 font-plex text-[11px] text-pub-muted">{idx}</span>
                          <span className="flex-1 text-[16px] font-medium text-pub-cream">{title}</span>
                          <span className="shrink-0 font-plex text-[11.5px] text-pub-muted">{dur}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* 4 · Try it */}
        <section id="try" className="border-b border-pub-hair py-24 sm:py-32">
          <Container>
            <Eyebrow n="02">Try it</Eyebrow>
            <Display className="mt-6 max-w-[40rem] text-[clamp(2.4rem,4vw,3.4rem)] leading-[1.0] text-pub-cream">
              What a losing streak does to your <em>capital.</em>
            </Display>
            <div className="mt-12">
              <RiskCalculator />
            </div>
          </Container>
        </section>

        {/* 5 · The desk */}
        <section id="desk" className="py-24 sm:py-32">
          <Container>
            <Eyebrow n="03">The desk</Eyebrow>
            <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-end">
              <Display className="text-[clamp(2.4rem,4vw,3.4rem)] leading-[1.0] text-pub-cream lg:col-span-7">
                Everything you trade from, on one <em>screen.</em>
              </Display>
              <p className="text-[16px] leading-[1.6] text-pub-muted lg:col-span-5">
                Built on Groww&apos;s official trading API — so it is your real account, your real positions and real
                orders. Nothing on the desk invents a number; if a value is missing, you see a dash.
              </p>
            </div>
            <ul className="mt-12 border-t border-pub-cream">
              {DESK.map(([code, name, desc]) => (
                <li key={code}>
                  <Link
                    href="/signup"
                    className="group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-1 border-b border-pub-hair px-1 py-5 transition-colors hover:bg-pub-card md:grid-cols-[5.5rem_minmax(0,0.9fr)_minmax(0,1.1fr)_auto] md:py-6"
                  >
                    <span className="col-span-2 font-plex text-[12px] text-pub-coral md:col-span-1">{code}</span>
                    <span className="pub-display text-[26px] leading-tight text-pub-cream">{name}</span>
                    <span className="col-span-2 text-[14px] leading-relaxed text-pub-muted md:col-span-1 md:text-[14.5px]">{desc}</span>
                    <span className="text-pub-cream">
                      <Arrow />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        {/* 6 · Why */}
        <section id="why" className="bg-pub-ink2 py-24 sm:py-32">
          <Container>
            <Eyebrow n="04">Why this exists</Eyebrow>
            <Display className="mt-6 max-w-[42rem] text-[clamp(2.4rem,4vw,3.4rem)] leading-[1.0] text-pub-cream">
              A trading desk, minus the <em>sales pitch.</em>
            </Display>
            <div className="mt-16 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
              {(
                [
                  [G.vault, "Your money stays put", "Cash and shares never leave your Groww account. We take no custody and an API key cannot withdraw a rupee.", "/#faq", "Where money sits"],
                  [G.bars, "Honest numbers", "Every setup shows its backtested win rate and expectancy — including the ones that don't work — and the costed simulation says plainly when it doesn't pay.", "/#desk", "See the desk"],
                  [G.key, "Keys, not passwords", "You paste a Groww API key, never your password. Keys are verified live and stored AES-256 encrypted.", "/legal/privacy", "Read the privacy policy"],
                  [G.scale, "Nothing promised", "No guaranteed returns and no paid tips. Decision-support software — you place and own every trade.", "/legal/risk-disclosure", "Read the risk disclosure"],
                ] as const
              ).map(([icon, title, body, href, link]) => (
                <div key={title}>
                  <span className="text-pub-cream">{icon}</span>
                  <p className="mt-7 border-b border-pub-cream pb-3 text-[12px] font-semibold tracking-[0.12em] text-pub-cream uppercase">
                    {title}
                  </p>
                  <p className="mt-4 text-[15.5px] leading-[1.6] text-pub-muted">{body}</p>
                  <div className="mt-5">
                    <TextLink href={href}>{link}</TextLink>
                  </div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* 7 · Membership on art */}
        <section id="membership" className="relative overflow-hidden py-14 sm:py-20">
          <WaveArt variant="band" uid="band" />
          <Container className="relative">
            <div className="max-w-[48rem] bg-pub-card p-7 sm:p-14">
              <Eyebrow n="05" tag="Optional">
                Membership
              </Eyebrow>
              <Display className="mt-6 text-[clamp(2.2rem,3.8vw,3.2rem)] leading-[1.0] text-pub-cream">
                The desk is yours. A fee only on new <em>highs.</em>
              </Display>
              <p className="mt-5 text-[16px] leading-[1.6] text-pub-muted">
                An optional performance-fee plan: {DEFAULT_FEE_PCT}% of any rise in your account value above its
                previous peak, worked out at the first complete live reading after each {DEFAULT_PERIOD_DAYS}-day
                period ends — or when you leave. No fee while you are below your peak, and no guarantee against a loss.
              </p>
              <ul className="mt-9 border-t border-pub-cream">
                {(
                  [
                    ["01", G.peak, "High-water mark", "Charged only above your previous peak. Leaving and re-joining keeps that peak, so a gain is never billed twice."],
                    ["02", G.shield, "No fee below your peak", "A down period costs no fee. The loss itself is yours; there is no loss cover."],
                    ["03", G.bank, "Your custody", "Capital stays in your own Groww account. Fees are billed separately, never auto-debited."],
                    ["04", G.door, "What is counted", "Cash plus holdings at live prices. Open F&O positions are excluded and deposits are not netted automatically — a gain that came from a deposit can be waived; ask us."],
                  ] as const
                ).map(([n, icon, title, body]) => (
                  <li key={n} className="grid grid-cols-[2rem_1.75rem_1fr] items-start gap-4 border-b border-pub-hair py-5">
                    <span className="pt-0.5 font-plex text-[11px] text-pub-muted">{n}</span>
                    <span className="text-pub-cream">{icon}</span>
                    <span>
                      <span className="block text-[16.5px] font-semibold text-pub-cream">{title}</span>
                      <span className="mt-1 block text-[14.5px] leading-relaxed text-pub-muted">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
                <Button href="/signup">Create your account</Button>
                <Mono className="text-pub-muted">
                  {DEFAULT_FEE_PCT}% of new highs · no fee below peak · no guarantee
                </Mono>
              </div>
              <p className="mt-7 border-t border-pub-hair pt-4 text-[12.5px] leading-relaxed text-pub-dim">
                Charging a performance fee requires SEBI registration (for example as a portfolio manager). MNHA is
                not registered as a Research Analyst or Investment Adviser — ask us for the registration this membership
                operates under before you enrol. MNHA does not manage or hold your money.
              </p>
            </div>
          </Container>
        </section>

        {/* 8 · FAQ */}
        <section id="faq" className="py-24 sm:py-32">
          <Container className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Eyebrow n="06">Questions</Eyebrow>
              <Display className="mt-6 text-[clamp(2.4rem,4vw,3.4rem)] leading-[1.0] text-pub-cream">
                The things people ask <em>first.</em>
              </Display>
              <p className="mt-6 text-[16px] leading-[1.6] text-pub-muted">
                Still unsure? Write to us from the{" "}
                <Link href="/legal/contact" className="text-pub-cream underline decoration-pub-accent decoration-2 underline-offset-4">
                  contact page
                </Link>
                .
              </p>
            </div>
            <div className="border-t border-pub-cream lg:col-span-8">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group border-b border-pub-hair">
                  <summary className="flex cursor-pointer items-center justify-between gap-6 py-5 text-[17px] font-medium text-pub-cream">
                    {q}
                    <span aria-hidden="true" className="text-[24px] leading-none font-light transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="max-w-[44rem] pb-6 text-[15.5px] leading-[1.65] text-pub-muted">{a}</p>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* 9 · CTA on art */}
        <section className="relative overflow-hidden py-16 sm:py-28">
          <WaveArt variant="diagonal" uid="cta" />
          <Container className="relative">
            <div className="max-w-[36rem] bg-pub-paper p-8 text-pub-ink sm:p-12">
              <Display className="text-[clamp(2.4rem,4.2vw,3.7rem)] leading-[1.0]">
                Fifteen minutes from now, your Groww account gets a better <em>desk.</em>
              </Display>
              <p className="mt-5 text-[16px] leading-[1.6] text-pub-ink/75">
                Create your login, sign the agreement, and connect Groww with the guided wizard. Nothing is traded until
                you confirm it.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-4">
                <Button href="/signup" variant="ink">
                  Create your account
                </Button>
                <TextLink href="/login" tone="ink">
                  Sign in
                </TextLink>
              </div>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
