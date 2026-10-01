import type { Metadata } from "next";
import Link from "next/link";
import { canTrade } from "@/lib/api/broker";
import { scorecards, openSignalsTagged, engineStatus } from "@/lib/signals/engine";
import MarketMood from "@/components/MarketMood";
import OrderTicket from "@/components/OrderTicket";
import RefreshSignals from "@/components/RefreshSignals";
import { PageHead, Pill, Card, Empty, SectionHead } from "@/components/ui";
import { marketState } from "@/lib/market";
import { requireOwnerPage } from "@/lib/access";

export const metadata: Metadata = { title: "Signals · MNHA Financials" };

// Reads the live engine state and journal — never bake this at build time.
export const dynamic = "force-dynamic";

function ago(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Mono small-caps labels — the editorial voice for every stat caption. */
const LABEL = "font-mono text-[10px] tracking-[0.08em] text-ink3 uppercase";
const EYEBROW = "font-mono text-[11px] tracking-[0.08em] text-ink3 uppercase";

function num(v: number | null, digits = 2, suffix = ""): string {
  return v === null ? "—" : `${v.toFixed(digits)}${suffix}`;
}

export default async function SignalsPage() {
  await requireOwnerPage();
  const [cards, signals] = await Promise.all([scorecards(), openSignalsTagged()]);
  const status = engineStatus();
  const tradable = canTrade();
  const mkt = marketState();

  const longs = signals.filter((s) => s.side === "LONG");
  const shorts = signals.filter((s) => s.side === "SHORT");
  const edgeCount = signals.filter((s) => s.edge).length;
  const warmingUp = cards.every((c) => c.backtest === null || c.backtest.trades === 0);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0">
        <PageHead
          title="Signals"
          sub="Both-side setups on real NSE candles, scored by a backtest and by their own live outcomes. Nothing here is a guarantee — it is a measured edge that updates itself."
          right={
            <div className="flex items-center gap-2">
              <Link
                href="/stocks/alerts/backtest"
                className="inline-flex h-9 items-center gap-1.5 border border-line2 px-3.5 text-[12.5px] font-semibold text-ink hover:bg-surfaceh"
              >
                Backtest on ₹1L <span className="pub-arrow">→</span>
              </Link>
              <RefreshSignals />
            </div>
          }
        />

        {/* engine status */}
        <div className="mb-6 flex flex-wrap items-center gap-2 text-[12px] text-ink3">
          <Pill tone={status.running ? "up" : "neutral"}>{status.running ? "Engine running" : "Engine idle"}</Pill>
          <Pill tone={mkt.isLive ? "up" : "neutral"}>{mkt.label}</Pill>
          <span className="leading-relaxed">
            Daily setups scanned once a session, intraday on a 3-min loop · last scan{" "}
            <span className="tnum">{ago(status.lastScan)}</span> · edge recomputed{" "}
            <span className="tnum">{ago(status.lastBacktest)}</span>
          </span>
        </div>

        {/* strategy scorecards */}
        <SectionHead title="Strategy scorecard" right={<span className={EYEBROW}>{cards.length} setups</span>} />
        {warmingUp ? (
          <Card pad={false}>
            <Empty
              title="Warming up the backtest"
              hint="The engine is pulling real candles and scoring each strategy over them. This fills a minute or two after the server starts — hit “Run scan now” to force it."
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <Card key={c.strategy}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <h3 className="pub-display text-[22px] leading-tight text-ink">{c.label}</h3>
                      <Pill tone={c.edge ? "up" : "warn"}>{c.edge ? "Active" : "Retired"}</Pill>
                    </div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink3">{c.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                  <div>
                    <p className={LABEL}>Backtest win</p>
                    <p className="tnum mt-1 text-[16px] font-semibold text-ink">{num(c.backtest?.winRate ?? null, 0, "%")}</p>
                    <p className="tnum text-[10.5px] text-ink3">{c.backtest?.trades ?? 0} trades</p>
                  </div>
                  <div>
                    <p className={LABEL}>Profit factor</p>
                    <p className="tnum mt-1 text-[16px] font-semibold text-ink">{num(c.backtest?.profitFactor ?? null, 2)}</p>
                    <p className="tnum text-[10.5px] text-ink3">exp {num(c.backtest?.expectancy ?? null, 2, "R")}</p>
                  </div>
                  <div>
                    <p className={LABEL}>Live win</p>
                    <p className={`tnum mt-1 text-[16px] font-semibold ${c.liveWinRate === null ? "text-ink3" : "text-ink"}`}>
                      {num(c.liveWinRate, 0, "%")}
                    </p>
                    <p className="tnum text-[10.5px] text-ink3">{c.liveResolved} done · {c.liveOpen} open</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-[12px]">
                  <span className="text-ink3">Blended edge (self-learned)</span>
                  <span className={`tnum font-semibold ${c.blendedExpectancy != null && c.blendedExpectancy > 0 ? "text-up" : "text-down"}`}>
                    {num(c.blendedExpectancy, 3, "R / trade")}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* live signals — ALL setups, both sides, tagged by measured edge */}
        <SectionHead
          title="Signals now"
          className="mt-9"
          right={<span className={EYEBROW}>{signals.length} open · {edgeCount} edge-backed</span>}
        />
        <p className="mb-6 -mt-1 max-w-3xl text-[13px] leading-relaxed text-ink3">
          Every setup that has fired, both directions — manual trading, your call. The{" "}
          <span className="font-semibold text-up">Edge</span> tag means that strategy currently has a measured positive edge;{" "}
          <span className="font-semibold text-ink2">No edge</span> means it fires but has not paid in its backtest and live record combined (measured before costs), so treat it as
          information, not a recommendation.
        </p>
        {signals.length === 0 ? (
          <Card pad={false}>
            <Empty
              title={mkt.isLive ? "No setup is open right now" : "Market is closed — no live signals"}
              hint={
                mkt.isLive
                  ? "None of the setups is triggered on the latest bar. When a fresh bar fires one — any direction — it appears here with its entry, stop and target."
                  : "Signals are read off the latest closed bar during market hours (9:15–15:30 IST). The backtested scorecard above stays available any time."
              }
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {[{ title: "Long / buy-side (CE)", rows: longs }, { title: "Short / sell-side (PE)", rows: shorts }].map(
              (grp) =>
                grp.rows.length > 0 && (
                  <div key={grp.title}>
                    <h3 className="mb-3 flex items-baseline justify-between gap-3 border-b border-line pb-2">
                      <span className="pub-display text-[22px] leading-tight text-ink">{grp.title}</span>
                      <span className={EYEBROW}>{grp.rows.length} open</span>
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {grp.rows.map((s) => {
                        const isIndex = s.segment === "FNO";
                        return (
                          <Card key={s.id} className="flex flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[15px] font-semibold tracking-tight text-ink">{s.symbol}</p>
                                <p className="mt-0.5 text-[12px] text-ink3">{s.stratLabel}</p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                <Pill tone={s.side === "LONG" ? "up" : "down"}>{s.side}</Pill>
                                <Pill tone={s.edge ? "up" : "neutral"}>{s.edge ? "Edge" : "No edge"}</Pill>
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                              <div>
                                <p className={LABEL}>Entry</p>
                                <p className="tnum mt-1 text-[13.5px] font-semibold text-ink">{s.entry.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className={LABEL}>Stop</p>
                                <p className="tnum mt-1 text-[13.5px] font-semibold text-down">{s.stop.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className={LABEL}>Target</p>
                                <p className="tnum mt-1 text-[13.5px] font-semibold text-up">{s.target.toFixed(2)}</p>
                              </div>
                            </div>
                            <p className="mt-3 flex-1 text-[12px] leading-snug text-ink3">
                              {s.reason} · <span className="tnum">{s.rr.toFixed(1)}R</span>
                            </p>

                            <div className="mt-3 border-t border-line pt-3">
                              {isIndex ? (
                                <Link
                                  href={`/fno/chain?u=${s.symbol}`}
                                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 border border-line2 text-[13px] font-semibold text-ink hover:bg-surfaceh"
                                >
                                  Trade via {s.side === "LONG" ? "Call" : "Put"} — open chain <span className="pub-arrow">→</span>
                                </Link>
                              ) : (
                                <OrderTicket
                                  symbol={s.symbol}
                                  company={s.symbol}
                                  ltp={s.entry}
                                  side={s.side === "LONG" ? "BUY" : "SELL"}
                                  suggestedPrice={s.entry}
                                  trigger={{ label: s.side === "LONG" ? "Buy" : "Sell", variant: s.side === "LONG" ? "primary" : "danger", full: true }}
                                  disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                                />
                              )}
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ),
            )}
          </div>
        )}
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
