import type { Metadata } from "next";
import Link from "next/link";
import { canTrade } from "@/lib/api/broker";
import { scorecards, actionableSignals, engineStatus } from "@/lib/signals/engine";
import { strategyByName } from "@/lib/signals/strategies";
import MarketMood from "@/components/MarketMood";
import OrderTicket from "@/components/OrderTicket";
import RefreshSignals from "@/components/RefreshSignals";
import { PageHead, Pill, Card, Empty, SectionHead } from "@/components/ui";
import { marketState } from "@/lib/market";

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

function num(v: number | null, digits = 2, suffix = ""): string {
  return v === null ? "—" : `${v.toFixed(digits)}${suffix}`;
}

export default async function SignalsPage() {
  const [cards, signals] = await Promise.all([scorecards(), actionableSignals()]);
  const status = engineStatus();
  const tradable = canTrade();
  const mkt = marketState();

  const longs = signals.filter((s) => s.side === "LONG");
  const shorts = signals.filter((s) => s.side === "SHORT");
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
                className="inline-flex h-9 items-center rounded-lg border border-line px-3.5 text-[12.5px] font-semibold text-ink2 hover:bg-surfaceh hover:text-ink"
              >
                Backtest on ₹1L →
              </Link>
              <RefreshSignals />
            </div>
          }
        />

        {/* the honest banner — this is the promise the tool will NOT make */}
        <Card className="mb-6 border-warn/40 bg-warnsoft/40">
          <div className="flex gap-3">
            <span className="mt-0.5 text-warn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
            </span>
            <div className="text-[13px] leading-relaxed text-ink2">
              <p className="font-semibold text-ink">There is no zero-loss, 20%-a-month setup — anywhere.</p>
              <p className="mt-1">
                SEBI&apos;s own study found 9 in 10 F&amp;O traders lose money. What this engine does
                is honest and useful: it reads real candles, fires long <em>and</em> short setups, and
                shows each one&apos;s <strong>measured</strong> hit rate and expectancy — from a backtest
                first, then from its own live results. A setup that stops paying is retired automatically.
                Losses are capped by the stop on every signal, not eliminated. Trade small, size by the stop.
              </p>
            </div>
          </div>
        </Card>

        {/* engine status */}
        <div className="mb-6 flex flex-wrap items-center gap-2 text-[12px] text-ink3">
          <Pill tone={status.running ? "up" : "neutral"}>{status.running ? "Engine running" : "Engine idle"}</Pill>
          <Pill tone={mkt.isLive ? "up" : "neutral"}>{mkt.label}</Pill>
          <span>Daily setups scanned once a session, intraday on a 3-min loop</span>
          <span>· last scan {ago(status.lastScan)}</span>
          <span>· edge recomputed {ago(status.lastBacktest)}</span>
        </div>

        {/* strategy scorecards */}
        <SectionHead title="Strategy scorecard" right={<span className="text-[13px] text-ink3">{cards.length} setups</span>} />
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
                    <div className="flex items-center gap-2">
                      <h3 className="text-[14.5px] font-bold tracking-tight text-ink">{c.label}</h3>
                      <Pill tone={c.edge ? "up" : "warn"}>{c.edge ? "Active" : "Retired"}</Pill>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink3">{c.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
                  <div>
                    <p className="text-[10.5px] tracking-wide text-ink3 uppercase">Backtest win</p>
                    <p className="tnum text-[15px] font-semibold text-ink">{num(c.backtest?.winRate ?? null, 0, "%")}</p>
                    <p className="tnum text-[10.5px] text-ink3">{c.backtest?.trades ?? 0} trades</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] tracking-wide text-ink3 uppercase">Profit factor</p>
                    <p className="tnum text-[15px] font-semibold text-ink">{num(c.backtest?.profitFactor ?? null, 2)}</p>
                    <p className="tnum text-[10.5px] text-ink3">exp {num(c.backtest?.expectancy ?? null, 2, "R")}</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] tracking-wide text-ink3 uppercase">Live win</p>
                    <p className={`tnum text-[15px] font-semibold ${c.liveWinRate === null ? "text-ink3" : "text-ink"}`}>
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

        {/* live signals, both sides */}
        <SectionHead title="Signals now" className="mt-9" right={<span className="text-[13px] text-ink3">{signals.length} open · active setups only</span>} />
        {signals.length === 0 ? (
          <Card pad={false}>
            <Empty
              title={mkt.isLive ? "No active-setup signal open right now" : "Market is closed — no live signals"}
              hint={
                mkt.isLive
                  ? "The engine only surfaces signals from strategies whose blended edge is currently positive. When a fresh bar triggers one, it appears here with its entry, stop and target."
                  : "Signals are read off live 15-minute bars during market hours (9:15–15:30 IST). The backtested edge above stays available any time."
              }
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {[{ title: "Long / buy-side (CE)", rows: longs }, { title: "Short / sell-side (PE)", rows: shorts }].map(
              (grp) =>
                grp.rows.length > 0 && (
                  <div key={grp.title}>
                    <h3 className="mb-3 text-[13.5px] font-semibold text-ink2">{grp.title}</h3>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {grp.rows.map((s) => {
                        const strat = strategyByName(s.strategy);
                        const isIndex = s.segment === "FNO";
                        return (
                          <Card key={s.id} className="flex flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[14.5px] font-bold tracking-tight text-ink">{s.symbol}</p>
                                <p className="text-[11.5px] text-ink3">{strat?.label ?? s.strategy}</p>
                              </div>
                              <Pill tone={s.side === "LONG" ? "up" : "down"}>{s.side}</Pill>
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className="text-[10px] text-ink3 uppercase">Entry</p>
                                <p className="tnum text-[13px] font-semibold text-ink">{s.entry.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-ink3 uppercase">Stop</p>
                                <p className="tnum text-[13px] font-semibold text-down">{s.stop.toFixed(2)}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-ink3 uppercase">Target</p>
                                <p className="tnum text-[13px] font-semibold text-up">{s.target.toFixed(2)}</p>
                              </div>
                            </div>
                            <p className="mt-2 text-[11.5px] text-ink3">{s.reason} · {s.rr.toFixed(1)}R</p>

                            <div className="mt-3 border-t border-line pt-3">
                              {isIndex ? (
                                <Link
                                  href={`/fno/chain?u=${s.symbol}`}
                                  className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-line text-[13px] font-semibold text-brandtext hover:bg-surfaceh"
                                >
                                  Trade via {s.side === "LONG" ? "Call" : "Put"} — open chain
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
