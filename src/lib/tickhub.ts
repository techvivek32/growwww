import "server-only";
import { getTicks, hasCredentials, type Tick } from "./api/groww";

/**
 * The tick hub: one Groww poller feeding every connected browser.
 *
 * Browsers do not poll Groww-shaped work at all — they hold an SSE stream and
 * the hub pushes. However many tabs are open, upstream traffic is exactly one
 * batched LTP request per cycle plus the slow quote refresh inside getTicks.
 *
 * 400ms per cycle ≈ 150 LTP requests/min, comfortably inside Groww's 300/min
 * live-data budget with the quote trickle on top. The loop only runs while at
 * least one client is connected; an idle server makes no upstream calls.
 */

const CYCLE_MS = 400;

interface Client {
  id: number;
  symbols: Set<string>;
  send: (payload: string) => void;
}

interface Hub {
  clients: Map<number, Client>;
  nextId: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
}

/** Survives dev-mode module reloads; systemd runs a single process anyway. */
const hub: Hub = ((globalThis as Record<string, unknown>).__mnhaTickHub ??= {
  clients: new Map(),
  nextId: 1,
  timer: null,
  running: false,
}) as Hub;

function unionSymbols(): string[] {
  const all = new Set<string>();
  for (const c of hub.clients.values()) for (const s of c.symbols) all.add(s);
  return [...all];
}

async function cycle(): Promise<void> {
  if (hub.clients.size === 0) {
    hub.running = false;
    hub.timer = null;
    return;
  }

  const started = Date.now();
  const symbols = unionSymbols();

  if (symbols.length > 0 && hasCredentials()) {
    try {
      const ticks = await getTicks(symbols);
      if (Object.keys(ticks).length > 0) {
        broadcast(ticks);
      }
    } catch (err) {
      console.error("[tickhub]", err instanceof Error ? err.message : err);
    }
  }

  // Fixed cadence measured from cycle start, so a slow upstream response
  // does not stack extra calls on top of the budget.
  const wait = Math.max(50, CYCLE_MS - (Date.now() - started));
  hub.timer = setTimeout(() => void cycle(), wait);
}

function broadcast(ticks: Record<string, Tick>): void {
  for (const c of hub.clients.values()) {
    // Each client only receives the symbols it watches — no point shipping a
    // scanner's 40 rows to a tab that shows the strip.
    const mine: Record<string, Tick> = {};
    for (const s of c.symbols) if (ticks[s]) mine[s] = ticks[s];
    if (Object.keys(mine).length === 0) continue;
    try {
      c.send(`data: ${JSON.stringify({ ticks: mine })}\n\n`);
    } catch {
      hub.clients.delete(c.id);
    }
  }
}

function ensureRunning(): void {
  if (hub.running) return;
  hub.running = true;
  void cycle();
}

export function subscribe(symbols: string[], send: (payload: string) => void): () => void {
  const id = hub.nextId++;
  hub.clients.set(id, { id, symbols: new Set(symbols), send });
  ensureRunning();
  return () => {
    hub.clients.delete(id);
  };
}
