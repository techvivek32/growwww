import type { Metadata } from "next";
import { getTrades, isConnected } from "@/lib/api/broker";
import { fmtMoney, fmtMoneySigned, toneText } from "@/lib/format";
import { PageHead, StatTile, Card, CardHead, SymbolChip } from "@/components/ui";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Analysis · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const trades = await getTrades();

  if (trades.length === 0) {
    return (
      <>
        <PageHead
          title="Analysis"
          sub="Realised performance from FIFO-matched round-trips — a buy and a sell in the same instrument."
        />
        <NotConnected
          connected={isConnected()}
          what="No closed round-trips yet"
          detail="Win rate and P&L are computed only from a matched buy and sell. Nothing is estimated, so nothing appears until a position has actually been opened and closed."
        />
      </>
    );
  }

  // Gross only: Groww's order payload carries no per-trade charges, and an
  // account-level figure is not a substitute. Every label says "before charges".
  const grossOf = (t: (typeof trades)[number]) =>
    (t.exit - t.entry) * t.qty * (t.side === "BUY" ? 1 : -1);

  const total = trades.reduce((s, t) => s + grossOf(t), 0);
  const wins = trades.filter((t) => grossOf(t) > 0);
  const losses = trades.filter((t) => grossOf(t) <= 0);
  const best = [...trades].sort((a, b) => grossOf(b) - grossOf(a))[0];
  const worst = [...trades].sort((a, b) => grossOf(a) - grossOf(b))[0];

  const avgWin = wins.length ? wins.reduce((s, t) => s + grossOf(t), 0) / wins.length : null;
  const avgLoss = losses.length
    ? Math.abs(losses.reduce((s, t) => s + grossOf(t), 0) / losses.length)
    : null;

  const bySymbol = Object.values(
    trades.reduce<Record<string, { symbol: string; gross: number; trades: number }>>((acc, t) => {
      acc[t.symbol] ??= { symbol: t.symbol, gross: 0, trades: 0 };
      acc[t.symbol].gross += grossOf(t);
      acc[t.symbol].trades += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.gross - a.gross);

  const maxAbs = Math.max(...bySymbol.map((s) => Math.abs(s.gross))) || 1;

  return (
    <>
      <PageHead
        title="Analysis"
        sub="FIFO-matched round-trips from real fills. All figures are gross — Groww's API does not report per-trade charges."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Gross P&L (before charges)"
          value={fmtMoneySigned(total, 0)}
          tone={total >= 0 ? "up" : "down"}
          sub={`${trades.length} round-trips`}
        />
        <StatTile
          label="Win rate"
          value={`${Math.round((wins.length / trades.length) * 100)}%`}
          sub={`${wins.length}W · ${losses.length}L`}
        />
        <StatTile
          label="Avg win / avg loss"
          value={avgWin !== null && avgLoss !== null && avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : "—"}
          sub={
            avgWin !== null && avgLoss !== null
              ? `${fmtMoney(avgWin, 0)} vs ${fmtMoney(avgLoss, 0)}`
              : "Needs at least one win and one loss"
          }
        />
        <StatTile label="Round-trips" value={String(trades.length)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="Best and worst round-trip" sub="Gross, before charges" />
          <div className="space-y-3">
            {(trades.length === 1 ? [{ label: "Only trade", t: best, tone: toneText(grossOf(best)) }] : [
              { label: "Best", t: best, tone: "text-up" },
              { label: "Worst", t: worst, tone: "text-down" },
            ]).map(({ label, t, tone }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface2 px-3 py-3"
              >
                <SymbolChip symbol={t.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-ink3">{label}</p>
                  <p className="text-[14px] font-semibold text-ink">{t.symbol}</p>
                  <p className="text-[11.5px] text-ink3">
                    {t.date || "—"} · {t.qty} qty · {fmtMoney(t.entry)} → {fmtMoney(t.exit)}
                  </p>
                </div>
                <p className={`tnum text-[16px] font-semibold ${tone}`}>{fmtMoneySigned(grossOf(t), 0)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="Gross P&L by stock" sub="Before charges" />
          <ul className="space-y-2.5">
            {bySymbol.map((s) => (
              <li key={s.symbol} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-[12.5px] font-semibold text-ink">{s.symbol}</span>
                <span className="relative h-5 flex-1 rounded bg-surface2">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${s.gross >= 0 ? "bg-up/35" : "bg-down/35"}`}
                    style={{ width: `${(Math.abs(s.gross) / maxAbs) * 100}%` }}
                  />
                </span>
                <span className={`tnum w-24 shrink-0 text-right text-[12.5px] font-semibold ${toneText(s.gross)}`}>
                  {fmtMoneySigned(s.gross, 0)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
