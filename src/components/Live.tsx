"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fmtMoney, fmtNum, fmtPct, toneText } from "@/lib/format";
import { useTick } from "./LiveTicks";

/**
 * Client leaves that keep a single price current.
 *
 * Server components render the value they had at request time and hand it
 * here as `initial`; these subscribe to the poller and re-render as ticks
 * arrive. Until the first tick lands the server value stays on screen, so
 * nothing ever blanks while the feed warms up.
 */

function useFlash(value: number): "up" | "down" | null {
  const previous = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const before = previous.current;
    if (value === before) return;
    previous.current = value;
    setFlash(value > before ? "up" : "down");
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [value]);

  return flash;
}

/** A rupee price that ticks. `plain` renders without the ₹ sign. */
export function LivePrice({
  symbol,
  initial,
  decimals = 2,
  plain = false,
  className = "",
}: {
  symbol: string;
  initial: number;
  decimals?: number;
  plain?: boolean;
  className?: string;
}) {
  const tick = useTick(symbol);
  const value = tick?.last ?? initial;
  const flash = useFlash(value);

  return (
    <span
      className={`tnum rounded px-0.5 transition-colors duration-500 ${
        flash === "up" ? "bg-upsoft text-up" : flash === "down" ? "bg-downsoft text-down" : ""
      } ${className}`}
    >
      {plain ? fmtNum(value, decimals) : fmtMoney(value, decimals)}
    </span>
  );
}

/** "+94.45 (0.40%)" with its sign colour, ticking. */
export function LiveChange({
  symbol,
  initialChange,
  initialPct,
  className = "",
}: {
  symbol: string;
  initialChange: number;
  initialPct: number;
  className?: string;
}) {
  const tick = useTick(symbol);
  const change = tick?.change ?? initialChange;
  const pct = tick?.changePct ?? initialPct;

  return (
    <span className={`tnum ${toneText(change)} ${className}`}>
      {change >= 0 ? "+" : ""}
      {change.toFixed(2)} ({fmtPct(pct)})
    </span>
  );
}

/** Just the percent, ticking — for table columns. */
export function LivePct({
  symbol,
  initial,
  className = "",
}: {
  symbol: string;
  initial: number;
  className?: string;
}) {
  const tick = useTick(symbol);
  const pct = tick?.changePct ?? initial;
  return <span className={`tnum ${toneText(pct)} ${className}`}>{fmtPct(pct)}</span>;
}

/** Wrapper for composed lines that only need the subscription side effect. */
export function LiveRegion({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
