import "server-only";
import { modesFor } from "./executor";
import type { DayState, LiveSettings, LiveOrder } from "./store";

/**
 * What today's automatic strategy means for ONE account, in that account's
 * own words.
 *
 * This lived inline in the Home page. It is here because the phone needs the
 * same sentence and the tree is too subtle to keep two copies of: it decides
 * whether someone is told their money is in today's trades. Two
 * implementations that drifted would eventually tell a member the opposite of
 * what the website told them, about their own positions.
 *
 * The order of the branches is load-bearing and kept exactly as the page had
 * it. In particular "already traded today" is answered before "could still
 * trade", because once a position is open what matters is that it will be
 * closed — not whether a new one could still be opened.
 */

export type StrategyTone = "ink" | "warn" | "muted";
export interface StrategyStatus {
  value: string;
  tone: StrategyTone;
}

export interface StrategyInput {
  /** The acting account. */
  uid: string;
  /** Today's plan, or null outside a trading day / before it is read. */
  today: DayState | null;
  /** Today's orders across all accounts. */
  todays: LiveOrder[];
  /** The live-trading settings, or null when they could not be read. */
  live: LiveSettings | null;
  /** IST minute of day. */
  minute: number;
  keptOut: boolean;
  isOwner: boolean;
  /** The house key is configured (owner only). */
  houseReady: boolean;
  /** This account has a usable order address. */
  addressAllowed: boolean;
  /** Broker credentials are stored for this account. */
  hasCredentials: boolean;
  /** Free cash, or null when Groww could not be read. */
  free: number | null;
  /** The base value an account needs free to take part. */
  baseRs: number;
  /** The base value, already formatted for display. */
  baseLabel: string;
}

export function strategyStatus(i: StrategyInput): StrategyStatus {
  // "In play": today's accounts are fixed, the 15:15 close has not run, and it
  // is not yet 15:32. Until then what the account ACTUALLY got today decides,
  // not a fresh look at cash or at the switch — the strategy's margin lowers
  // free cash, and a day is closed in the mode it opened in.
  const inPlay =
    i.today?.accounts && !i.today.done.close && i.minute < 15 * 60 + 32 ? i.today : null;

  const mine = i.todays.filter(
    (o) => o.accountId === i.uid && o.source === "auto" && o.mode === inPlay?.mode,
  );
  const traded = mine.some(
    (o) => (o.filled ?? 0) > 0 || ["placed", "unknown", "sending", "shadow"].includes(o.state),
  );
  const opensNow = inPlay && i.live ? modesFor(i.live, inPlay).open === inPlay.mode : false;
  const mayStill = Boolean(
    inPlay?.accounts?.includes(i.uid) &&
      !i.keptOut &&
      opensNow &&
      (!inPlay.done.entry || !inPlay.done.flip),
  );
  const shadowDay = inPlay?.mode === "shadow";

  // Can MNHA send to this account at all right now? (Its order address, its
  // Groww key, the house key.) A Groww READ that failed just now is not
  // counted: that alone does not stop MNHA's orders.
  const reachable = i.addressAllowed && i.hasCredentials && (!i.isOwner || i.houseReady);

  if (inPlay) {
    if (!shadowDay && traded && !reachable) {
      return {
        value:
          "Automatic strategy: MNHA cannot send orders to your Groww right now — if a strategy position is open, close it in Groww (Groww squares intraday positions off itself near 15:20)",
        tone: "warn",
      };
    }
    if (!shadowDay && !traded && mayStill && !reachable) {
      return {
        value:
          "Automatic strategy: your account cannot take part right now (MNHA cannot send orders to your Groww)",
        tone: "warn",
      };
    }
    if (i.keptOut) {
      return {
        value:
          traded && !shadowDay
            ? "Automatic strategy: your account is kept out — what it opened today is still closed by about 15:15"
            : "Automatic strategy: your account is kept out",
        tone: "muted",
      };
    }
    if (traded || mayStill) {
      if (shadowDay) {
        return {
          value: "Automatic strategy: today runs in shadow mode — nothing is sent",
          tone: "muted",
        };
      }
      return traded
        ? {
            value:
              "Automatic strategy: your account is in today's trades — its positions are closed by about 15:15",
            tone: "ink",
          }
        : { value: "Automatic strategy: your account is set to take part today", tone: "ink" };
    }
    return {
      value: opensNow
        ? "Automatic strategy: your account is not in today's trades"
        : "Automatic strategy: not sending orders now",
      tone: "muted",
    };
  }

  // Outside a fixed day: the switch, then this account's own readiness.
  if (!i.live) return { value: "Automatic strategy: status unavailable", tone: "warn" };
  if (i.keptOut) return { value: "Automatic strategy: your account is kept out", tone: "muted" };
  if (i.live.mode !== "live") {
    return { value: "Automatic strategy: not sending orders now", tone: "muted" };
  }
  if (!i.addressAllowed || (i.isOwner && !i.houseReady)) {
    return {
      value:
        "Automatic strategy: on — your account cannot take part (no usable order address on your Groww key)",
      tone: "warn",
    };
  }
  // Cash that could not be read is reported as unknown, never as "too little":
  // a failed read is not evidence of an empty account.
  if (i.free === null) {
    return {
      value:
        "Automatic strategy: on — your Groww cash could not be read just now, so whether your account takes part is not known",
      tone: "warn",
    };
  }
  if (i.free < i.baseRs) {
    return {
      value: `Automatic strategy: on — your account has less than ${i.baseLabel} free, so it takes no part`,
      tone: "warn",
    };
  }
  return {
    value:
      "Automatic strategy: on — your account takes part when it has at least that much free shortly before 09:20",
    tone: "ink",
  };
}
