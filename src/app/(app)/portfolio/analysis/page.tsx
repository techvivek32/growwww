import type { Metadata } from "next";
import { getTrades } from "@/lib/api/broker";
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
        <PageHead title="Analysis" sub="Realised performance, computed from closed round-trips." />
        <NotConnected
          what="Nothing to analyse yet"
          detail="Win rate, expectancy and P&L by stock are all computed from real closed trades. They appear once your Groww account has some."
        />
      </>
    );
  }

  const netOf = (t: (typeof trades)[number]) =>
    (t.exit - t.entry) * t.qty * (t.side === "BUY" ? 1 : -1) - t.charges;

  const total = trades.reduce((s, t) => s + netOf(t), 0);
  const wins = trades.filter((t) => netOf(t) > 0);
  const losses = trades.filter((t) => netOf(t) <= 0);
  const avgWin = wins.reduce((s, t) => s + netOf(t), 0) / (wins.length || 1);
  const avgLoss = Math.abs(losses.reduce((s, t) => s + netOf(t), 0) / (losses.length || 1));
  const best = [...trades].sort((a, b) => netOf(b) - netOf(a))[0];
  const worst = [...trades].sort((a, b) => netOf(a) - netOf(b))[0];

  const bySymbol = Object.values(
    trades.reduce<Record<string, { symbol: string; net: number; trades: number }>>((acc, t) => {
      acc[t.symbol] ??= { symbol: t.symbol, net: 0, trades: 0 };
      acc[t.symbol].net += netOf(t);
      acc[t.symbol].trades += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.net - a.net);

  const maxAbs = Math.max(...bySymbol.map((s) => Math.abs(s.net))) || 1;

  return (
    <>
      <PageHead title="Analysis" sub="Realised performance. Round-trips only — no guessed numbers." />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Net P&L"
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
          value={(avgWin / avgLoss).toFixed(2)}
          sub={`${fmtMoney(avgWin, 0)} vs ${fmtMoney(avgLoss, 0)}`}
        />
        <StatTile label="Trades" value={String(trades.length)} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="Best and worst trade" />
          <div className="space-y-3">
            {[
              { label: "Best", t: best, tone: "text-up" },
              { label: "Worst", t: worst, tone: "text-down" },
            ].map(({ label, t, tone }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface2 px-3 py-3"
              >
                <SymbolChip symbol={t.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-ink3">{label}</p>
                  <p className="text-[14px] font-semibold text-ink">{t.symbol}</p>
                  <p className="text-[11.5px] text-ink3">
                    {t.day} · {t.qty} qty · {fmtMoney(t.entry)} → {fmtMoney(t.exit)}
                  </p>
                </div>
                <p className={`tnum text-[16px] font-semibold ${tone}`}>{fmtMoneySigned(netOf(t), 0)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="Realised P&L by stock" sub="Net of all charges" />
          <ul className="space-y-2.5">
            {bySymbol.map((s) => (
              <li key={s.symbol} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-[12.5px] font-semibold text-ink">{s.symbol}</span>
                <span className="relative h-5 flex-1 rounded bg-surface2">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${s.net >= 0 ? "bg-up/35" : "bg-down/35"}`}
                    style={{ width: `${(Math.abs(s.net) / maxAbs) * 100}%` }}
                  />
                </span>
                <span className={`tnum w-24 shrink-0 text-right text-[12.5px] font-semibold ${toneText(s.net)}`}>
                  {fmtMoneySigned(s.net, 0)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
