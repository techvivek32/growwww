"use client";

import { useEffect, useState } from "react";
import { marketState, type MarketState } from "@/lib/market";

const DOT: Record<MarketState["phase"], string> = {
  open: "bg-up",
  "pre-open": "bg-warn",
  post: "bg-ink3",
  closed: "bg-ink3",
  holiday: "bg-ink3",
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
    return <div className="hidden h-8 w-56 animate-pulse border border-line bg-surface2 sm:block" aria-hidden="true" />;
  }

  return (
    <div className="hidden h-8 items-center gap-2 border border-line px-2.5 font-mono text-[11px] tracking-[0.04em] whitespace-nowrap sm:flex">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[state.phase]} ${state.isLive ? "live-dot" : ""}`} aria-hidden="true" />
      <span className="font-medium text-ink uppercase">{state.label}</span>
      <span className="tnum text-ink3">
        {state.date} · {state.clock}
      </span>
    </div>
  );
}
