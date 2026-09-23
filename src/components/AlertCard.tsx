import type { StockAlert } from "@/lib/alerts";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Card, Pill, Tag, SymbolChip, Sparkline } from "./ui";
import OrderTicket from "./OrderTicket";

const NO_TRADE = "Order placement is disabled on this server";

/* ------------------------------------------------------------ level tiles */

/**
 * Entry / Target / Stop as three static levels. Deliberately no progress
 * meter between them: nobody holds this trade, so there is no progress to
 * report — a moving marker would be theatre.
 *
 * Order levels keep their paise (a stop is a number someone types into a
 * ticket), so the value is allowed to shrink rather than round.
 */
function Levels({ a }: { a: StockAlert }) {
  const tgtPct = ((a.target - a.entry) / a.entry) * 100;
  const stopPct = ((a.stop - a.entry) / a.entry) * 100;
  const cell = "min-w-0 rounded-lg border border-line bg-surface2 px-2 py-2.5 text-center";
  const value = "tnum mt-1 truncate text-[13.5px] font-semibold sm:text-[14.5px]";

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className={cell}>
        <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">Entry · mkt</p>
        <p className={`${value} text-ink`}>{fmtMoney(a.entry)}</p>
        <p className="tnum text-[10px] text-ink3">last traded</p>
      </div>
      <div className={cell}>
        <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">Target</p>
        <p className={`${value} text-up`}>{fmtMoney(a.target)}</p>
        <p className="tnum text-[10px] text-up">
          {fmtPct(tgtPct)}
          {a.targetIsLevel ? " · 20-day high" : " · 2R"}
        </p>
      </div>
      <div className={cell}>
        <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">Stop</p>
        <p className={`${value} text-down`}>{fmtMoney(a.stop)}</p>
        <p className="tnum text-[10px] text-down">{fmtPct(stopPct)}</p>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 90 ? "up" : score >= 80 ? "brand" : "neutral";
  return <Pill tone={tone}>Score {score}</Pill>;
}

/** R/R · RSI · Vol readout; segments that could not be computed are absent. */
function Metrics({ a, ltp = false }: { a: StockAlert; ltp?: boolean }) {
  const bits: string[] = [`R/R ${a.rr.toFixed(1)}`];
  if (a.rsi !== null) bits.push(`RSI ${a.rsi}`);
  if (a.volX !== null) bits.push(`Vol ${a.volX.toFixed(1)}x`);
  return (
    <span className="tnum text-[12px] text-ink3">
      {ltp && (
        <>
          LTP <span className="font-semibold text-ink">{fmtMoney(a.last)}</span> ·{" "}
        </>
      )}
      {bits.join(" · ")}
    </span>
  );
}

/* -------------------------------------------------------------- hero card */

export function BestTrade({ a, canTrade }: { a: StockAlert; canTrade: boolean }) {
  return (
    <Card className="border-brand/40">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-wider text-brandtext uppercase">
          Highest-scoring setup
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <SymbolChip symbol={a.symbol} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[20px] leading-none font-bold tracking-tight text-ink">{a.symbol}</h3>
              <ScoreBadge score={a.score} />
              <span className="text-[12px] text-ink3">{a.timeframe}</span>
            </div>
            <p className="mt-1 truncate text-[13px] text-ink3">{a.company}</p>
            <p className="tnum mt-2 text-[15px] font-semibold text-ink">
              {fmtMoney(a.last)}{" "}
              <span className={`text-[12px] font-medium ${a.changePct >= 0 ? "text-up" : "text-down"}`}>
                {a.change >= 0 ? "+" : ""}
                {a.change.toFixed(2)} ({fmtPct(a.changePct)})
              </span>
            </p>
          </div>
        </div>

        <div className="w-full sm:w-auto sm:min-w-[300px] sm:flex-1">
          <Levels a={a} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <OrderTicket
          symbol={a.symbol}
          company={a.company}
          ltp={a.last}
          suggestedPrice={a.entry}
          trigger={{ label: `Buy ${a.symbol}` }}
          disabledReason={canTrade ? undefined : NO_TRADE}
        />
        <span className="ml-auto">
          <Metrics a={a} />
        </span>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- grid card */

export function AlertCard({ a, canTrade }: { a: StockAlert; canTrade: boolean }) {
  const up = a.changePct >= 0;
  return (
    // h-full + flex-col so every card in the grid is the same height and the
    // buttons line up regardless of how many reason tags a setup carries.
    <Card className="flex h-full flex-col">
      <div className="flex items-start gap-3">
        <SymbolChip symbol={a.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-bold tracking-tight text-ink">{a.symbol}</h3>
            <span className="text-[11px] text-ink3">{a.timeframe}</span>
          </div>
          <p className="truncate text-[12px] text-ink3">{a.company}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ScoreBadge score={a.score} />
          <Sparkline points={a.spark} up={up} w={64} h={20} />
        </div>
      </div>

      <div className="mt-4">
        <Levels a={a} />
      </div>

      <p className="mt-3">
        <Metrics a={a} ltp />
      </p>

      {/* flex-1 absorbs the height difference between 1-line and 2-line tag sets */}
      <div className="mt-3 flex flex-1 flex-wrap content-start gap-1.5">
        {a.tags.slice(0, 3).map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>

      <div className="mt-4">
        <OrderTicket
          symbol={a.symbol}
          company={a.company}
          ltp={a.last}
          suggestedPrice={a.entry}
          trigger={{ label: "Buy", full: true }}
          disabledReason={canTrade ? undefined : NO_TRADE}
        />
      </div>
    </Card>
  );
}
