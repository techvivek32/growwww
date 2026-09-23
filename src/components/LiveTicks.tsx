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
 * Live prices for the whole app.
 *
 * Primary transport is an SSE stream: the server's tick hub polls Groww at
 * its own fixed cadence and PUSHES — the browser does no timed polling, so a
 * tick reaches the screen as soon as the server has it. If the stream cannot
 * hold (old proxy, flaky network), the provider degrades to plain polling of
 * /api/ticks and keeps working.
 *
 * Components fall back to their server-rendered values until the first tick,
 * so nothing ever blanks while the feed warms up. The stream closes when the
 * tab is hidden — nobody needs ticks for a window they are not looking at.
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
  /** Registers symbols for streaming; returns a cleanup. */
  watch: (symbols: string[]) => () => void;
}

const LiveCtx = createContext<Ctx>({ ticks: {}, watch: () => () => {} });

/** Fallback polling cadence when SSE is unavailable. */
const POLL_MS = 2000;

/** How long to wait after a symbol-set change before reconnecting the stream. */
const RESUBSCRIBE_DEBOUNCE_MS = 250;

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
    let closed = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let sseFailures = 0;

    const symbols = [...counts.current.keys()];

    const apply = (incoming: Record<string, Tick>) => {
      if (!closed && Object.keys(incoming).length > 0) {
        setTicks((prev) => ({ ...prev, ...incoming }));
      }
    };

    const stopStream = () => {
      source?.close();
      source = null;
    };

    /* ------------------------------ fallback: poll ------------------------ */
    const poll = async () => {
      if (closed) return;
      if (symbols.length > 0 && document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/ticks?symbols=${encodeURIComponent(symbols.join(","))}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const body = (await res.json()) as { ticks?: Record<string, Tick> };
            apply(body.ticks ?? {});
          }
        } catch {
          /* next poll retries */
        }
      }
      if (!closed) pollTimer = setTimeout(() => void poll(), POLL_MS);
    };

    /* ------------------------------ primary: SSE -------------------------- */
    const openStream = () => {
      if (closed || symbols.length === 0) return;
      if (document.visibilityState !== "visible") return;

      stopStream();
      source = new EventSource(`/api/stream?symbols=${encodeURIComponent(symbols.join(","))}`);

      source.onopen = () => {
        sseFailures = 0;
      };
      source.onmessage = (e) => {
        try {
          const body = JSON.parse(e.data) as { ticks?: Record<string, Tick> };
          apply(body.ticks ?? {});
        } catch {
          /* a malformed frame is dropped, the stream continues */
        }
      };
      source.onerror = () => {
        sseFailures += 1;
        // EventSource retries on its own; only after repeated failures does
        // the transport give way to polling.
        if (sseFailures >= 3) {
          stopStream();
          void poll();
        }
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (!source && !pollTimer) openStream();
      } else {
        stopStream();
        if (pollTimer) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    // Debounced: page mounts register several watchers back to back, and one
    // connection with the final set beats five short-lived ones.
    openTimer = setTimeout(openStream, RESUBSCRIBE_DEBOUNCE_MS);

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (openTimer) clearTimeout(openTimer);
      if (pollTimer) clearTimeout(pollTimer);
      stopStream();
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
