import type { Metadata } from "next";
import { TRADES, DAILY_PNL } from "@/lib/mock";
import { fmtMoney, fmtMoneySigned, toneText } from "@/lib/format";
import { PageHead, StatTile, Card, CardHead, SymbolChip } from "@/components/ui";
import PnlChart from "@/components/PnlChart";

export const metadata: Metadata = { title: "Analysis · NOVA India" };

export default function AnalysisPage() {
  const gross = TRADES.reduce((s, t) => s + t.pnl, 0);
  const charges = TRADES.reduce((s, t) => s + t.charges, 0);
  const net = gross - charges;
  const wins = TRADES.filter((t) => t.pnl > 0);
  const losses = TRADES.filter((t) => t.pnl <= 0);
  const best = [...TRADES].sort((a, b) => b.pnl - a.pnl)[0];
  const worst = [...TRADES].sort((a, b) => a.pnl - b.pnl)[0];
  const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / (wins.length || 1);
  const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / (losses.length || 1));
  const greenDays = DAILY_PNL.filter((d) => d.pnl > 0).length;

  /* P&L aggregated by stock, biggest contributors first. */
  const byStock = Object.values(
    TRADES.reduce<Record<string, { symbol: string; pnl: number; trades: number }>>((acc, t) => {
      acc[t.symbol] ??= { symbol: t.symbol, pnl: 0, trades: 0 };
      acc[t.symbol].pnl += t.pnl - t.charges;
      acc[t.symbol].trades += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.pnl - a.pnl);

  const maxAbs = Math.max(...byStock.map((s) => Math.abs(s.pnl))) || 1;

  return (
    <>
      <PageHead title="Analysis" sub="Realised performance since 11 Aug. Round-trips only — no guessed numbers." />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Net P&L" value={fmtMoneySigned(net, 0)} tone={net >= 0 ? "up" : "down"} sub={`${TRADES.length} round-trips`} />
        <StatTile label="Win rate" value={`${Math.round((wins.length / TRADES.length) * 100)}%`} sub={`${wins.length}W · ${losses.length}L`} />
        <StatTile label="Avg win / avg loss" value={(avgWin / avgLoss).toFixed(2)} sub={`${fmtMoney(avgWin, 0)} vs ${fmtMoney(avgLoss, 0)}`} />
        <StatTile label="Green days" value={`${greenDays}/${DAILY_PNL.length}`} sub="Sessions closed positive" />
      </div>

      <Card className="mb-5">
        <CardHead title="Daily realised P&L" sub="Each bar is one NSE session" />
        <PnlChart />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="Best and worst trade" />
          <div className="space-y-3">
            {[
              { label: "Best", t: best, tone: "text-up" },
              { label: "Worst", t: worst, tone: "text-down" },
            ].map(({ label, t, tone }) => (
              <div key={label} className="flex items-center gap-3 rounded-lg border border-line bg-surface2 px-3 py-3">
                <SymbolChip symbol={t.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] tracking-wider text-ink3 uppercase">{label}</p>
                  <p className="text-[14px] font-semibold text-ink">{t.symbol}</p>
                  <p className="text-[11px] text-ink3">
                    {t.date} · {t.qty} qty · {fmtMoney(t.entry)} → {fmtMoney(t.exit)}
                  </p>
                </div>
                <p className={`tnum text-[16px] font-semibold ${tone}`}>{fmtMoneySigned(t.pnl, 0)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="Realised P&L by stock" sub="Net of all charges" />
          <ul className="space-y-2.5">
            {byStock.map((s) => (
              <li key={s.symbol} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-[12px] font-semibold text-ink">{s.symbol}</span>
                <span className="relative h-5 flex-1 rounded bg-surface2">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${s.pnl >= 0 ? "bg-up/35" : "bg-down/35"}`}
                    style={{ width: `${(Math.abs(s.pnl) / maxAbs) * 100}%` }}
                  />
                </span>
                <span className={`tnum w-24 shrink-0 text-right text-[12px] font-semibold ${toneText(s.pnl)}`}>
                  {fmtMoneySigned(s.pnl, 0)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
