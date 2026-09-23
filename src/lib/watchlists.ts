import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Watchlists, persisted to a JSON file next to the app.
 *
 * A single-user terminal does not need a database for a few named lists of
 * symbols. Writes go through one in-process queue and land via tmp+rename,
 * so a crash mid-write leaves the previous file intact rather than half a
 * JSON document.
 */

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface Store {
  lists: Watchlist[];
}

const FILE = process.env.WATCHLIST_FILE ?? path.join(process.cwd(), "data", "watchlists.json");

const DEFAULT: Store = {
  lists: [
    {
      id: "default",
      name: "My watchlist",
      symbols: ["RELIANCE", "HDFCBANK", "INFY", "TCS", "ITC", "SBIN", "LT", "TATASTEEL"],
    },
  ],
};

const g = globalThis as { __mnhaWatchlists?: { queue: Promise<unknown> } };
g.__mnhaWatchlists ??= { queue: Promise.resolve() };

/** Serialises every mutation; readers can go direct. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaWatchlists!.queue.then(job, job);
  g.__mnhaWatchlists!.queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<Store> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!Array.isArray(parsed.lists)) return structuredClone(DEFAULT);
    return parsed;
  } catch {
    return structuredClone(DEFAULT);
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export async function getWatchlists(): Promise<Watchlist[]> {
  return (await read()).lists;
}

export async function createList(name: string): Promise<Watchlist> {
  return enqueue(async () => {
    const store = await read();
    const trimmed = name.trim().slice(0, 40) || "Watchlist";
    const id = `wl-${Date.now().toString(36)}`;
    const list: Watchlist = { id, name: trimmed, symbols: [] };
    store.lists.push(list);
    await write(store);
    return list;
  });
}

export async function deleteList(id: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    // The last list never deletes — an empty page with no tabs is a dead end.
    if (store.lists.length <= 1) return;
    store.lists = store.lists.filter((l) => l.id !== id);
    await write(store);
  });
}

export async function addSymbol(id: string, symbol: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const list = store.lists.find((l) => l.id === id);
    if (!list) return;
    const s = symbol.trim().toUpperCase();
    if (!list.symbols.includes(s) && list.symbols.length < 50) {
      list.symbols.push(s);
      await write(store);
    }
  });
}

export async function removeSymbol(id: string, symbol: string): Promise<void> {
  return enqueue(async () => {
    const store = await read();
    const list = store.lists.find((l) => l.id === id);
    if (!list) return;
    list.symbols = list.symbols.filter((x) => x !== symbol.trim().toUpperCase());
    await write(store);
  });
}
