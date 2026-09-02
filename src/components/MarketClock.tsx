"use client";

import { useEffect, useState } from "react";
import { marketState, type MarketState } from "@/lib/market";

const DOT: Record<MarketState["phase"], string> = {
  open: "bg-up",
  "pre-open": "bg-warn",
  post: "bg-ink3",
  closed: "bg-ink3",
};

/**
 * NSE session badge. The clock only starts after mount — rendering a live
 * time on the server would guarantee a hydration mismatch every load.
 */
export default function MarketClock() {
  const [state, setState] = useState<MarketState | null>(null);

  useEffect(() => {
    const tick = () => setState(marketState());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!state) {
    return (
      <div className="hidden h-8 w-56 animate-pulse rounded-full bg-surface2 sm:block" aria-hidden="true" />
    );
  }

  return (
    <div className="hidden items-center gap-2 rounded-full border border-line bg-surface2 py-1.5 pr-3 pl-2.5 sm:flex">
      <span className={`h-2 w-2 rounded-full ${DOT[state.phase]} ${state.isLive ? "live-dot" : ""}`} />
      <span className="text-[12px] font-semibold text-ink">{state.label}</span>
      <span className="tnum text-[12px] text-ink3">
        {state.date} · {state.clock}
      </span>
    </div>
  );
}
