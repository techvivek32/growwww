import "server-only";
import { notify, notifyAdmin } from "@/lib/notifications";
import { listMembers } from "@/lib/membership";
import { listKyc } from "@/lib/kyc";

/**
 * The time-based half of the alert system.
 *
 * Most notifications are born from something a person just did — an order, a
 * settlement, a verification decision — and are emitted at the call site. The
 * ones here have no such moment: a performance period ending, a video call
 * tomorrow morning, a submission that has sat unreviewed since yesterday.
 * Nothing happens at the instant they become true, so something has to look.
 *
 * ## Why it is safe to run this on a loop
 *
 * Every emit below passes a `key` derived from the thing it is about — the
 * period's end timestamp, the call's timestamp, the day of the reminder — and
 * `notify()` drops a repeat of the same (userId, key). So an hourly sweep
 * sends each of these exactly once no matter how many times it runs, and a
 * server restart cannot re-buzz anybody. That property is what lets this be a
 * dumb polling loop instead of a scheduler with its own durable state.
 *
 * It deliberately does NOT live inside the live-trading executor. That loop
 * places real orders and its timing is tuned to the market session; hanging a
 * once-an-hour housekeeping job off it would mean a slow filesystem read in
 * here could delay a square-off.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** How long before a period ends to warn the member. Long enough to act on
 *  (adding or withdrawing funds moves the closing NAV), short enough to mean
 *  something. */
const PERIOD_WARN_MS = 3 * DAY;

/** How long a submitted verification may sit before the admin is nudged. */
const KYC_STALE_MS = DAY;

const g = globalThis as { __mnhaSweep?: { timer: NodeJS.Timeout | null; lastRunAt: number; lastError: string | null } };
g.__mnhaSweep ??= { timer: null, lastRunAt: 0, lastError: null };
const S = g.__mnhaSweep;

/** IST calendar day, for keys that should fire once a day rather than once ever. */
function istDay(at: number): string {
  return new Date(at + 5.5 * HOUR).toISOString().slice(0, 10);
}

function inDays(ms: number): string {
  const d = Math.round(ms / DAY);
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

/** The same span read backwards. inDays() is future tense — it returns
 *  "in 2 days", which cannot take a trailing "ago" without reading as
 *  "in 2 days ago". The two admin notices below are about something that has
 *  already happened, so they need this instead. */
function daysAgo(ms: number): string {
  const d = Math.round(ms / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Members whose performance period closes soon, and periods already due. */
async function memberships(now: number): Promise<void> {
  let members;
  try {
    members = await listMembers();
  } catch (e) {
    console.error("[sweep] could not read memberships:", e instanceof Error ? e.message : e);
    return;
  }

  for (const m of members) {
    if (m.status !== "active") continue;
    const left = m.periodEndsAt - now;

    if (left > 0 && left <= PERIOD_WARN_MS) {
      await notify(m.userId, {
        kind: "account",
        tone: "neutral",
        route: "account",
        title: "Performance period ends soon",
        body:
          `Your current period closes ${inDays(left)}. The fee is worked out from your account value at ` +
          `that point, and only on profit above your previous peak — a loss is never billed.`,
        // Keyed to this period, so moving the end date re-arms it and a
        // restart does not send a second warning for the same one.
        key: `period-ending-${m.periodEndsAt}`,
      });
    }

    // Past its end and still open: only the admin can settle it, and until
    // somebody does, the member's fee is being worked out from a stale mark.
    if (left <= 0) {
      await notifyAdmin({
        tone: "warn",
        route: "admin:members",
        title: "Performance period ready to settle",
        body: `A member's period ended ${daysAgo(-left)} and is still open. Settle it from Members.`,
        key: `settle-due-${m.userId}-${m.periodEndsAt}`,
      });
    }
  }
}

/** Verification calls coming up, and submissions nobody has looked at. */
async function verification(now: number): Promise<void> {
  let records;
  try {
    records = await listKyc();
  } catch (e) {
    console.error("[sweep] could not read verifications:", e instanceof Error ? e.message : e);
    return;
  }

  for (const r of records) {
    if (r.callAt && r.callAt > now && r.callAt - now <= DAY) {
      const at = new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      }).format(new Date(r.callAt));
      await notify(r.userId, {
        kind: "account",
        tone: "neutral",
        route: "account",
        title: "Verification call tomorrow",
        body: `Your identity-verification video call is at ${at} IST. The joining link is on your verification page.`,
        key: `kyc-call-${r.callAt}`,
      });
    }

    if (r.status === "submitted" && r.submittedAt > 0 && now - r.submittedAt >= KYC_STALE_MS) {
      await notifyAdmin({
        tone: "warn",
        route: "admin:kyc",
        title: "Verification still waiting for review",
        body: `${r.fullName || "A client"} submitted ${daysAgo(now - r.submittedAt)} and has not been reviewed.`,
        // Once per day while it stays unreviewed, rather than once ever —
        // a nudge that fires a single time is one somebody scrolls past.
        key: `kyc-stale-${r.userId}-${istDay(now)}`,
      });
    }
  }
}

/** One pass. Exported so the admin console can trigger it and so it is testable. */
export async function sweepOnce(): Promise<void> {
  const now = Date.now();
  try {
    await memberships(now);
    await verification(now);
    S.lastError = null;
  } catch (e) {
    S.lastError = e instanceof Error ? e.message : String(e);
    console.error("[sweep] failed:", S.lastError);
  } finally {
    S.lastRunAt = Date.now();
  }
}

export function sweepStatus() {
  return { started: S.timer !== null, lastRunAt: S.lastRunAt || null, lastError: S.lastError };
}

/**
 * Start the hourly loop. Idempotent — a second call (another bundle, a dev
 * reload) does nothing, the same guard the trading executor uses.
 *
 * The first pass is delayed: boot is the worst moment to start reading every
 * membership and verification file, and nothing here is urgent to the minute.
 */
export function startAlertSweep(): void {
  if (S.timer) return;
  const run = () => {
    void sweepOnce();
  };
  S.timer = setTimeout(function first() {
    run();
    S.timer = setInterval(run, HOUR);
  }, 60_000);
  console.log("[sweep] alert sweep started");
}
