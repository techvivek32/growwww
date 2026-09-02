import type { StockAlert } from "@/lib/mock";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Card, Pill, Tag, Button, SymbolChip, Sparkline } from "./ui";

/* ------------------------------------------------------------------- rail */

/**
 * Where price sits between the stop and the target. This is the single most
 * useful glance in the product: left of centre means the trade is working
 * against you, right means it is running.
 */
export function TradeRail({
  stop,
  entry,
  target,
  last,
}: {
  stop: number;
  entry: number;
  target: number;
  last: number;
}) {
  const span = target - stop || 1;
  const pos = Math.min(100, Math.max(0, ((last - stop) / span) * 100));
  const entryPos = Math.min(100, Math.max(0, ((entry - stop) / span) * 100));
  const toTarget = target > last ? ((target - last) / (target - entry || 1)) * 100 : 0;

  return (
    <div>
      <div className="relative h-1.5 w-full rounded-full bg-downsoft">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-up/25"
          style={{ width: `${pos}%` }}
        />
        {/* entry marker */}
        <span
          className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink3"
          style={{ left: `${entryPos}%` }}
          aria-hidden="true"
        />
        {/* live price marker */}
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-up"
          style={{ left: `${pos}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink3">
        <span>Stop</span>
        <span className="font-medium text-ink2">
          {toTarget > 0 ? `${toTarget.toFixed(0)}% to target` : "At target"}
        </span>
        <span>Target</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ level tiles */

function Levels({ a }: { a: StockAlert }) {
  const tgtPct = ((a.target - a.entry) / a.entry) * 100;
  const stopPct = ((a.stop - a.entry) / a.entry) * 100;
  const cell = "rounded-lg border border-line bg-surface2 px-3 py-2.5 text-center";

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className={cell}>
        <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">Entry</p>
        <p className="tnum mt-1 text-[15px] font-semibold text-ink">{fmtMoney(a.entry)}</p>
      </div>
      <div className={cell}>
        <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">Target</p>
        <p className="tnum mt-1 text-[15px] font-semibold text-up">{fmtMoney(a.target)}</p>
        <p className="tnum text-[10px] text-up">{fmtPct(tgtPct)}</p>
      </div>
      <div className={cell}>
        <p className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">Stop</p>
        <p className="tnum mt-1 text-[15px] font-semibold text-down">{fmtMoney(a.stop)}</p>
        <p className="tnum text-[10px] text-down">{fmtPct(stopPct)}</p>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 90 ? "up" : score >= 80 ? "brand" : "neutral";
  return (
    <Pill tone={tone}>
      Score {score}
    </Pill>
  );
}

function NewsLine({ news }: { news: NonNullable<StockAlert["news"]> }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
      <Pill tone={news.tone === "Bullish" ? "up" : news.tone === "Bearish" ? "down" : "neutral"}>
        {news.tone}
      </Pill>
      <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink2">
        {news.headline}
        <span className="text-ink3"> · {news.source}</span>
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- hero card */

export function BestTrade({ a }: { a: StockAlert }) {
  return (
    <Card className="border-brand/40">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[11px] font-bold tracking-wider text-brandtext uppercase">
          Best trade of the moment
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
              {fmtMoney(a.last)} <span className="text-[12px] font-normal text-ink3">LTP</span>
            </p>
          </div>
        </div>

        <div className="w-full sm:w-auto sm:min-w-[300px] sm:flex-1">
          <Levels a={a} />
        </div>
      </div>

      <div className="mt-4">
        <TradeRail stop={a.stop} entry={a.entry} target={a.target} last={a.last} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.tags.map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>

      {a.news && (
        <div className="mt-3">
          <NewsLine news={a.news} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button className="min-w-[140px]">Buy {a.symbol}</Button>
        <Button variant="outline">Add to watchlist</Button>
        <span className="tnum ml-auto text-[12px] text-ink3">
          R/R {a.rr.toFixed(1)} · RSI {a.rsi} · Vol {a.volX.toFixed(1)}x
        </span>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------- grid card */

export function AlertCard({ a }: { a: StockAlert }) {
  const up = a.last >= a.entry;
  return (
    // h-full + flex-col so every card in the grid is the same height and the
    // Buy buttons line up regardless of how many reason tags a setup carries.
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

      <div className="mt-3">
        <TradeRail stop={a.stop} entry={a.entry} target={a.target} last={a.last} />
      </div>

      <p className="tnum mt-3 text-[12px] text-ink3">
        LTP <span className="font-semibold text-ink">{fmtMoney(a.last)}</span> · R/R {a.rr.toFixed(1)} · RSI{" "}
        {a.rsi} · Vol {a.volX.toFixed(1)}x
      </p>

      {/* flex-1 absorbs the height difference between 1-line and 2-line tag sets */}
      <div className="mt-3 flex flex-1 flex-wrap content-start gap-1.5">
        {a.tags.slice(0, 3).map((t) => (
          <Tag key={t}>{t}</Tag>
        ))}
      </div>

      <div className="mt-4">
        <Button className="w-full">Buy</Button>
      </div>
    </Card>
  );
}
