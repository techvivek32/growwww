import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BrokerCreds } from "@/lib/users";
import type { Egress } from "./egress";

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

/**
 * Which address the current request's broker calls go out from.
 *
 * Kept beside the credentials because the two belong together: a client's key
 * is registered against one address, so using their key from any other address
 * gets the call refused. `undefined` means the default (the house address).
 */
const egressStore = new AsyncLocalStorage<Egress | undefined>();

export function runWithEgress<T>(egress: Egress | undefined, fn: () => T): T {
  return egressStore.run(egress, fn);
}

export function currentEgress(): Egress | undefined {
  return egressStore.getStore();
}
