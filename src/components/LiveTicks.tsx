"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Keeps prices moving after the server render.
 *
 * Pages render with whatever was current at request time; this polls
 * /api/ticks and hands fresher numbers to any component that asks for a
 * symbol. Components fall back to their server-rendered values, so a failed
 * poll leaves the last known price on screen rather than blanking it.
 *
 * Polling pauses when the tab is hidden — nobody needs ticks for a window
 * they are not looking at, and it keeps the request budget for the tab that
 * is actually in front of someone.
 */

export interface Tick {
  symbol: string;
  last: number;
  prevClose: number;
  change: number;
  changePct: number;
}

interface Ctx {
  ticks: Record<string, Tick>;
  /** Registers a symbol for polling; returns a cleanup. */
  watch: (symbols: string[]) => () => void;
}

const LiveCtx = createContext<Ctx>({ ticks: {}, watch: () => () => {} });

const POLL_MS = 3000;

export function LiveTicksProvider({ children }: { children: ReactNode }) {
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  // Reference-counted so two components watching NIFTY do not make one
  // unmount stop the other's updates.
  const counts = useRef<Map<string, number>>(new Map());
  const [version, setVersion] = useState(0);

  const watch = useCallback((symbols: string[]) => {
    const map = counts.current;
    for (const s of symbols) map.set(s, (map.get(s) ?? 0) + 1);
    setVersion((v) => v + 1);

    return () => {
      for (const s of symbols) {
        const n = (map.get(s) ?? 1) - 1;
        if (n <= 0) map.delete(s);
        else map.set(s, n);
      }
      setVersion((v) => v + 1);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;

      const symbols = [...counts.current.keys()];
      if (symbols.length > 0 && document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/ticks?symbols=${encodeURIComponent(symbols.join(","))}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const body = (await res.json()) as { ticks?: Record<string, Tick> };
            if (!cancelled && body.ticks && Object.keys(body.ticks).length > 0) {
              setTicks((prev) => ({ ...prev, ...body.ticks }));
            }
          }
        } catch {
          // Keep the last values; the next poll will try again.
        }
      }

      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };

    // First poll right away — a screen that only moves after the first
    // interval reads as frozen for exactly that long.
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [version]);

  return <LiveCtx.Provider value={{ ticks, watch }}>{children}</LiveCtx.Provider>;
}

/**
 * Subscribe to one symbol. Returns the freshest tick, or null until one
 * arrives — callers keep showing their server-rendered numbers meanwhile.
 */
export function useTick(symbol: string): Tick | null {
  const { ticks, watch } = useContext(LiveCtx);

  useEffect(() => watch([symbol]), [symbol, watch]);

  return ticks[symbol] ?? null;
}

/** Subscribe to several at once, for a strip or a table. */
export function useTicks(symbols: string[]): Record<string, Tick> {
  const { ticks, watch } = useContext(LiveCtx);
  const key = symbols.join(",");

  useEffect(() => watch(key ? key.split(",") : []), [key, watch]);

  return ticks;
}
