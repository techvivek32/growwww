import type { Metadata } from "next";
import {
  TRADES, BY_SESSION, BY_SYMBOL, TOTAL_NET, TOTAL_GROSS, TOTAL_CHARGES,
  WIN_RATE, WINS, LOSSES, AVG_WIN, AVG_LOSS, BEST_TRADE, WORST_TRADE,
  OPENING_CAPITAL, CLOSING_BALANCE, RETURN_PCT, ACCOUNT,
  netPnl, holdMinutes,
} from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct, toneText } from "@/lib/format";
import { PageHead, StatTile, Card, CardHead, SymbolChip, Pill } from "@/components/ui";
import { EquityCurve, DailyBars } from "@/components/PnlChart";

export const metadata: Metadata = { title: "Analysis · MNHA Financials" };

export default function AnalysisPage() {
  const maxAbs = Math.max(...BY_SYMBOL.map((s) => Math.abs(s.net))) || 1;
  const avgHold = Math.round(TRADES.reduce((s, t) => s + holdMinutes(t), 0) / TRADES.length);
  const expectancy =
    (WIN_RATE / 100) * AVG_WIN - (1 - WIN_RATE / 100) * AVG_LOSS;

  return (
    <>
      <PageHead
        title="Analysis"
        sub={`${ACCOUNT.windowLabel} · ${ACCOUNT.sessions} NSE sessions. Closed round-trips only — no guessed numbers.`}
        right={<Pill tone="up">{fmtPct(RETURN_PCT)} on capital</Pill>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Net P&L"
          value={fmtMoneySigned(TOTAL_NET, 2)}
          tone="up"
          sub={`${fmtMoney(OPENING_CAPITAL, 0)} → ${fmtMoney(CLOSING_BALANCE)}`}
        />
        <StatTile label="Win rate" value={`${WIN_RATE}%`} sub={`${WINS.length}W · ${LOSSES.length}L of ${TRADES.length}`} />
        <StatTile
          label="Avg win / avg loss"
          value={(AVG_WIN / AVG_LOSS).toFixed(2)}
          sub={`${fmtMoney(AVG_WIN, 0)} vs ${fmtMoney(AVG_LOSS, 0)}`}
        />
        <StatTile
          label="Expectancy"
          value={fmtMoneySigned(expectancy, 0)}
          tone={expectancy >= 0 ? "up" : "down"}
          sub="Per trade, net of charges"
        />
      </div>

      <Card className="mb-5">
        <CardHead
          title="Account balance"
          sub={`Every closed trade, ${fmtMoney(OPENING_CAPITAL, 0)} to ${fmtMoney(CLOSING_BALANCE)}`}
          right={
            <span className="tnum text-[13px] font-semibold text-up">{fmtMoneySigned(TOTAL_NET, 0)}</span>
          }
        />
        <EquityCurve />
      </Card>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="P&L by session" sub="Net of all charges" />
          <DailyBars />
        </Card>

        <Card>
          <CardHead title="Where the money came from" sub="Realised P&L by stock, net of charges" />
          <ul className="space-y-2.5">
            {BY_SYMBOL.map((s) => (
              <li key={s.symbol} className="flex items-center gap-3">
                <span className="w-[92px] shrink-0 truncate text-[12px] font-semibold text-ink">{s.symbol}</span>
                <span className="relative h-5 flex-1 rounded bg-surface2">
                  <span
                    className={`absolute inset-y-0 left-0 rounded ${s.net >= 0 ? "bg-up/35" : "bg-down/35"}`}
                    style={{ width: `${(Math.abs(s.net) / maxAbs) * 100}%` }}
                  />
                </span>
                <span className={`tnum w-[92px] shrink-0 text-right text-[12px] font-semibold ${toneText(s.net)}`}>
                  {fmtMoneySigned(s.net, 0)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead title="Best and worst trade" />
          <div className="space-y-3">
            {[
              { label: "Best", t: BEST_TRADE, tone: "text-up" },
              { label: "Worst", t: WORST_TRADE, tone: "text-down" },
            ].map(({ label, t, tone }) => (
              <div key={label} className="flex items-center gap-3 rounded-lg border border-line bg-surface2 px-3 py-3">
                <SymbolChip symbol={t.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] tracking-wider text-ink3 uppercase">{label}</p>
                  <p className="text-[14px] font-semibold text-ink">{t.symbol}</p>
                  <p className="text-[11px] text-ink3">
                    {t.day} · {t.qty} qty · {fmtMoney(t.entry)} → {fmtMoney(t.exit)}
                  </p>
                </div>
                <p className={`tnum text-[16px] font-semibold ${tone}`}>{fmtMoneySigned(netPnl(t), 0)}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="Session summary" />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            {[
              { k: "Opening capital", v: fmtMoney(OPENING_CAPITAL, 0) },
              { k: "Closing balance", v: fmtMoney(CLOSING_BALANCE) },
              { k: "Gross P&L", v: fmtMoneySigned(TOTAL_GROSS, 0) },
              { k: "Total charges", v: fmtMoney(TOTAL_CHARGES) },
              { k: "Trades", v: String(TRADES.length) },
              { k: "Avg hold", v: `${Math.floor(avgHold / 60)}h ${avgHold % 60}m` },
              { k: "Sessions", v: `${BY_SESSION.length} (all green)` },
              { k: "Return on capital", v: fmtPct(RETURN_PCT) },
            ].map((r) => (
              <div key={r.k} className="border-b border-line pb-2.5 last:border-0">
                <dt className="text-[11px] tracking-wider text-ink3 uppercase">{r.k}</dt>
                <dd className="tnum mt-0.5 text-[14px] font-semibold text-ink">{r.v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-ink3">
        {fmtPct(RETURN_PCT)} across three sessions is an outlier, not a rate of return to expect or project. It came
        from concentrated intraday MIS positions carrying roughly 5x leverage into three unusually strong trend
        days; the same sizing on three bad days would have taken a comparable bite out of the account.
      </p>
    </>
  );
}
