import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BrokerCreds } from "@/lib/users";

/**
 * Per-request broker credentials, carried through the async call tree so a
 * broker call always runs against the RIGHT account without threading creds
 * through every function signature.
 *
 * Three states, and the difference is a safety boundary:
 *  - a creds object → use exactly these (a signed-in user's own Groww keys);
 *  - "none"         → a signed-in user who has NOT connected a broker — calls
 *                     must return empty, and MUST NOT fall back to the env
 *                     house account, or one user would see another's data;
 *  - undefined      → no request context at all (the background engine) —
 *                     the env house account is used for shared research data.
 */
export type CredState = BrokerCreds | "none" | undefined;

const store = new AsyncLocalStorage<CredState>();

export function runWithCreds<T>(state: CredState, fn: () => T): T {
  return store.run(state, fn);
}

export function currentCredState(): CredState {
  return store.getStore();
}
