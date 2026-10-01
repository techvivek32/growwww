import "server-only";
import { getTicks } from "@/lib/api/groww";
import { runWithCreds } from "@/lib/api/credctx";

/**
 * The landing page's "today's tape": real index quotes from Groww, read with
 * the house account (no visitor context), cached in-process for 30 seconds so
 * public traffic never fans out into broker calls. A missing quote stays null —
 * the card prints a dash, never a guess.
 */

export interface TapeRow {
  symbol: string;
  label: string;
  last: number | null;
  changePct: number | null;
}

export interface Tape {
  rows: TapeRow[];
  /** When the quotes were read (ms), or null if nothing came back. */
  at: number | null;
}

const SYMBOLS: [string, string][] = [
  ["NIFTY", "NIFTY 50"],
  ["BANKNIFTY", "BANK NIFTY"],
  ["SENSEX", "SENSEX"],
  ["FINNIFTY", "FIN NIFTY"],
];

const TTL_MS = 30_000;
const TIMEOUT_MS = 3_000;

const g = globalThis as { __mnhaTape?: { at: number; tape: Tape; inflight: Promise<Tape> | null } };

async function read(): Promise<Tape> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS));
  // `undefined` creds context = the server's own house account (shared market data).
  const ticks = await Promise.race([runWithCreds(undefined, () => getTicks(SYMBOLS.map(([s]) => s))).catch(() => null), timeout]);
  const rows = SYMBOLS.map(([symbol, label]) => {
    const t = ticks?.[symbol];
    return { symbol, label, last: t ? t.last : null, changePct: t ? t.changePct : null };
  });
  // "As of" is the OLDEST quote shown, not the time we asked — a fallback to
  // a cached quote must never be presented as current.
  const times = SYMBOLS.map(([s]) => ticks?.[s]?.quotedAt).filter((t): t is number => typeof t === "number");
  return { rows, at: times.length ? Math.min(...times) : null };
}

export async function getPublicTape(): Promise<Tape> {
  const hit = g.__mnhaTape;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tape;
  if (hit?.inflight) return hit.inflight;

  const inflight = read().then((tape) => {
    // Keep the last good tape if this read came back empty.
    const keep = tape.at === null && g.__mnhaTape?.tape.at ? g.__mnhaTape.tape : tape;
    g.__mnhaTape = { at: Date.now(), tape: keep, inflight: null };
    return keep;
  });
  g.__mnhaTape = { at: hit?.at ?? 0, tape: hit?.tape ?? { rows: [], at: null }, inflight };
  return inflight;
}
