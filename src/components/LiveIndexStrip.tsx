"use client";

import { useEffect, useRef, useState } from "react";
import { fmtNum, toneText } from "@/lib/format";
import Link from "next/link";
import { useTicks } from "./LiveTicks";

export interface StripRow {
  symbol: string;
  last: number;
  change: number;
  changePct: number;
  stale: boolean;
  asOf: string | null;
}

/**
 * One index. Flashes green or red for a moment when the level moves, the way
 * every trading screen does — it is the cheapest possible signal that the
 * number in front of you is alive rather than a stale render.
 */
function Cell({ row }: { row: StripRow }) {
  const previous = useRef(row.last);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = previous.current;
    if (row.last === before) return;
    previous.current = row.last;
    setFlash(row.last > before ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [row.last]);

  return (
    <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
      <Link href={`/stock/${row.symbol}`} className="text-[12px] font-semibold text-ink hover:text-brandtext">
        {row.symbol}
      </Link>
      {row.stale && (
        <span className="rounded bg-warnsoft px-1 py-0.5 text-[9px] font-semibold text-warn">
          snap {row.asOf}
        </span>
      )}
      <span
        className={`tnum rounded px-1 text-[12px] transition-colors duration-500 ${
          flash === "up" ? "bg-upsoft text-up" : flash === "down" ? "bg-downsoft text-down" : "text-ink2"
        }`}
      >
        {fmtNum(row.last, 2)}
      </span>
      <span className={`tnum text-[12px] ${toneText(row.change)}`}>
        {row.change >= 0 ? "+" : ""}
        {row.change.toFixed(2)} ({Math.abs(row.changePct).toFixed(2)}%)
      </span>
    </div>
  );
}

export default function LiveIndexStrip({ rows }: { rows: StripRow[] }) {
  // Stale rows are snapshot fallbacks — polling cannot refresh what is not
  // coming from the live feed, so they are not watched.
  const live = useTicks(rows.filter((r) => !r.stale).map((r) => r.symbol));

  const merged = rows.map((r) => {
    const t = live[r.symbol];
    return t && !r.stale
      ? { ...r, last: t.last, change: t.change, changePct: t.changePct }
      : r;
  });

  return (
    <div className="border-b border-line bg-surface">
      <div className="no-bar mx-auto flex max-w-[1360px] items-center gap-7 overflow-x-auto px-4 py-2.5 lg:px-6">
        {merged.map((row) => (
          <Cell key={row.symbol} row={row} />
        ))}
      </div>
    </div>
  );
}
