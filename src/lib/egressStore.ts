import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The pool of addresses a member's Groww traffic may be sent from.
 *
 * An exchange ties one registered static IP to one trading account, so each
 * member needs an address of their own. They are kept here rather than in the
 * environment so the admin can add one the moment a new address is bought,
 * without a redeploy.
 *
 * An entry is either:
 *  - local  — an address this host itself owns (the socket binds to it), or
 *  - proxy  — an address another host owns, reached by an HTTPS CONNECT
 *             tunnel that only this server may use.
 *
 * On first run the file is seeded from GROWW_EGRESS_MAP, so an existing
 * deployment keeps working exactly as configured.
 */

export interface EgressEntry {
  /** The public address the member registers on their Groww key. */
  ip: string;
  /** Tunnel to reach it; empty when this host owns the address itself. */
  proxy?: string;
  /** Free-text, e.g. where the address comes from. */
  note?: string;
  addedAt: number;
}

interface Store {
  items: EgressEntry[];
}

const FILE = process.env.EGRESS_FILE ?? path.join(process.cwd(), "data", "egress.json");

const g = globalThis as { __mnhaEgress?: { queue: Promise<unknown> } };
g.__mnhaEgress ??= { queue: Promise.resolve() };

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = g.__mnhaEgress!.queue.then(job, job);
  g.__mnhaEgress!.queue = run.catch(() => undefined);
  return run;
}

/** Entries configured in the environment — the seed, and a permanent fallback
 *  so a missing or unreadable file can never strand every member. */
function fromEnv(): EgressEntry[] {
  const raw = process.env.GROWW_EGRESS_MAP?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, { proxy?: string; local?: boolean }>;
    return Object.entries(parsed).map(([ip, v]) => ({
      ip,
      proxy: v?.proxy,
      note: "from configuration",
      addedAt: 0,
    }));
  } catch {
    console.error("[egress] GROWW_EGRESS_MAP is not valid JSON — ignoring it");
    return [];
  }
}

async function read(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Store;
    if (Array.isArray(parsed.items)) return parsed;
  } catch {
    /* missing or malformed — fall through to the environment */
  }
  return { items: fromEnv() };
}

async function write(store: Store): Promise<void> {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await rename(tmp, FILE);
}

export async function listEgress(): Promise<EgressEntry[]> {
  const { items } = await read();
  return [...items].sort((a, b) => a.addedAt - b.addedAt);
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

export function validIp(ip: string): boolean {
  return IPV4.test(ip) && ip.split(".").every((o) => Number(o) >= 0 && Number(o) <= 255);
}

export async function addEgress(input: { ip: string; proxy?: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  const ip = input.ip.trim();
  const proxy = input.proxy?.trim() || undefined;
  if (!validIp(ip)) return { ok: false, error: "Enter a valid IPv4 address, like 72.60.30.154." };
  if (proxy && !/^https?:\/\/[^\s]+$/i.test(proxy)) {
    return { ok: false, error: "The tunnel must be a URL, like http://72.60.30.154:8888." };
  }
  return enqueue(async () => {
    const store = await read();
    if (store.items.some((e) => e.ip === ip)) return { ok: false, error: "That address is already in the pool." };
    store.items.push({ ip, proxy, note: input.note?.trim().slice(0, 120) || undefined, addedAt: Date.now() });
    await write(store);
    return { ok: true };
  });
}

export async function removeEgress(ip: string): Promise<{ ok: boolean; error?: string }> {
  return enqueue(async () => {
    const store = await read();
    const before = store.items.length;
    store.items = store.items.filter((e) => e.ip !== ip);
    if (store.items.length === before) return { ok: false, error: "That address is not in the pool." };
    await write(store);
    return { ok: true };
  });
}
