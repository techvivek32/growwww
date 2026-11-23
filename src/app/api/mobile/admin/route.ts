import { loadAdmin } from "@/app/(admin)/admin/sections";
import { liveSummary, dayToIso, liveToday, type Sl05Trade } from "@/lib/research";
import { checkAccounts } from "@/lib/liveTrading/accounts";
import { ACTION_LABEL, getDay, getSettings, ordersOfDay, recentChanges } from "@/lib/liveTrading/store";
import { executorStatus } from "@/lib/liveTrading/executor";
import { watchPositions } from "@/lib/liveTrading/watch";
import { istNow } from "@/lib/liveTrading/util";
import { AGREEMENT_VERSION } from "@/lib/consent";
import { json, guarded, fail } from "@/lib/mobileApi";
import { tunnelLabel, houseRoute } from "@/lib/api/egress";
import {
  adminDisconnectBroker,
  adminDeleteUser,
  adminKycDecision,
  adminScheduleKycCall,
  adminMarkInvoice,
  adminAddEgress,
  adminRemoveEgress,
} from "@/app/(admin)/admin/actions";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/admin?view=… — the admin console, for the admin login only.
 *
 * Everything here comes from `loadAdmin()`, the same loader every web admin
 * page uses. That matters more here than anywhere else in this API: the
 * funnel, the fee totals and the "needs attention" list are derived figures,
 * and a second implementation would eventually disagree with the website
 * about how much money is outstanding.
 *
 * `loadAdmin()` returns Maps and closures that do not survive JSON, so this
 * projects them — but it never recomputes them.
 *
 * The role check is the real boundary. The proxy keeps non-admins out of
 * /admin on the web, but its ADMIN_ONLY list covers web paths, not
 * /api/mobile/, so without this a signed-in member could read the console
 * from a phone.
 */

const DAY = 86_400_000;
const isPast = (t: number) => t < Date.now();

export async function GET(req: Request) {
  return guarded(async (c) => {
    if (c.role !== "admin") return fail("The admin console is a separate sign-in.", 403);

    const view = new URL(req.url).searchParams.get("view") ?? "overview";
    const d = await loadAdmin();

    switch (view) {
      case "overview": {
        const live = await liveSummary().catch(() => null);

        const placedToday = d.countStatus(d.ordersToday, "placed");
        const rejectedToday = d.countStatus(d.ordersToday, "rejected");

        // Same six tiles as the web, in the same order.
        const tiles = [
          { label: "Users", value: `${d.users.length}`, sub: `${d.last7} new in 7 days` },
          {
            label: "Groww connected",
            value: `${d.connected}`,
            sub: `${d.users.length - d.connected} not yet`,
          },
          {
            label: "KYC in review",
            value: `${d.pendingKyc}`,
            sub: `${d.kyc.length} submitted`,
            tone: d.pendingKyc > 0 ? "down" : "neutral",
          },
          {
            label: "Active members",
            value: `${d.activeMembers.length}`,
            sub: "performance-fee",
          },
          {
            label: "Orders today",
            value: `${placedToday}`,
            sub: rejectedToday ? `${rejectedToday} rejected` : "none rejected",
            tone: rejectedToday > 0 ? "down" : "neutral",
          },
          {
            label: "Fees outstanding",
            value: d.sumFee("due"),
            sub: d.sumFee("paid"),
            money: true,
            tone: d.sumFee("due") > 0 ? "down" : "neutral",
          },
        ];

        // "Needs attention" — only the rows with a non-zero count, exactly as
        // the web filters them. An empty list is the good state, not a gap.
        const noAddress = d.users.filter((u) => u.hasBroker && !u.brokerStaticIp).length;
        const ended = d.activeMembers.filter((m) => isPast(m.periodEndsAt)).length;
        const oldAgreement = d.users.filter(
          (u) => !d.signedNow.has(u.id) && d.signedOld.has(u.id),
        ).length;
        const attention = [
          { n: d.pendingKyc, text: "identity verification waiting for review", view: "kyc" },
          {
            n: d.countInv("due"),
            text: `fee invoice${d.countInv("due") === 1 ? "" : "s"} due`,
            amount: d.sumFee("due"),
            view: "fees",
          },
          { n: ended, text: "member period ended, not settled yet", view: "fees" },
          { n: noAddress, text: "connected account without an order address", view: "addresses" },
          {
            n: oldAgreement,
            text: `signed an older agreement than v${AGREEMENT_VERSION}`,
            view: "consents",
          },
          { n: rejectedToday, text: "order rejected today", view: "orders" },
        ].filter((x) => x.n > 0);

        // Sign-ups per day for the last 14 days, oldest first.
        const start = new Date().setHours(0, 0, 0, 0);
        const signups = Array.from({ length: 14 }, (_, i) => {
          const s = start - (13 - i) * DAY;
          return {
            at: s,
            n: d.users.filter((u) => u.createdAt >= s && u.createdAt < s + DAY).length,
          };
        });

        return json({
          tiles,
          attention,
          funnel: d.funnel,
          money: {
            rows: [
              { label: "Billed", v: d.sumFee(), n: d.invoices.length },
              { label: "Collected", v: d.sumFee("paid"), n: d.countInv("paid"), tone: "up" },
              {
                label: "Outstanding",
                v: d.sumFee("due"),
                n: d.countInv("due"),
                tone: d.sumFee("due") > 0 ? "down" : undefined,
              },
              { label: "Waived / no fee", v: d.sumFee("waived"), n: d.countInv("waived") },
            ],
            allTime: {
              placed: d.countStatus(d.orders, "placed"),
              rejected: d.countStatus(d.orders, "rejected"),
              cancelled: d.countStatus(d.orders, "cancelled"),
            },
          },
          signups,
          // Null when the research box is unreachable, which is a normal
          // state for the console rather than an error worth failing on.
          paper: live,
          recentOrders: d.orderLog.slice(0, 10).map((o) => ({ ...o, who: d.who(o.userId) })),
          recentAccess: d.access.slice(0, 8).map((a) => ({ ...a, email: d.who(a.userId) })),
          agreementVersion: AGREEMENT_VERSION,
        });
      }

      case "accounts":
        // One row per user with every gate's state, which is what the web
        // Accounts table shows.
        return json({
          accounts: d.users.map((u) => ({
            ...u,
            signedCurrent: d.signedNow.has(u.id),
            signedOld: d.signedOld.has(u.id),
            kyc: d.kycFor.get(u.id)?.status ?? null,
            membership: d.memberFor.get(u.id)?.status ?? "none",
            orders: d.orderStats.get(u.id) ?? null,
            bills: d.billsFor.get(u.id) ?? { due: 0, paid: 0 },
          })),
          reserved: d.reserved,
        });

      case "members":
        return json({
          members: d.members.map((m) => ({ ...m, email: d.who(m.userId) })),
          activeCount: d.activeMembers.length,
        });

      case "kyc":
        return json({
          records: d.kyc.map((k) => ({ ...k, email: d.who(k.userId) })),
          pending: d.pendingKyc,
        });

      case "consents":
        return json({
          consents: d.consents.map((x) => ({ ...x, email: d.who(x.userId) })),
          agreementVersion: AGREEMENT_VERSION,
        });

      case "fees":
        return json({
          invoices: d.invoices.map((iv) => ({ ...iv, email: d.who(iv.userId) })),
          totals: {
            billed: d.sumFee(),
            paid: d.sumFee("paid"),
            due: d.sumFee("due"),
            waived: d.sumFee("waived"),
          },
        });

      case "orders":
        return json({
          orders: d.orderLog.map((o) => ({ ...o, who: d.who(o.userId) })),
          today: {
            placed: d.countStatus(d.ordersToday, "placed"),
            rejected: d.countStatus(d.ordersToday, "rejected"),
            cancelled: d.countStatus(d.ordersToday, "cancelled"),
          },
        });

      case "addresses": {
        // The house account's address is never handed to a new member, so it
        // is listed once as the house's and kept out of the member pool. It
        // used to appear as just another row, which on a phone read as "free
        // to give away" — the exact opposite of what it is.
        const holdersOf = (ip: string) =>
          d.users.filter((u) => u.hasBroker && u.brokerStaticIp === ip).map((u) => u.email);
        return json({
          // A tunnel's host and port only: never a login that may be part of its URL.
          pool: d.pool
            .filter((e) => e.ip !== d.house)
            .map((e) => ({
              ...e,
              proxy: e.proxy ? tunnelLabel(e.proxy) : undefined,
              holders: holdersOf(e.ip),
            })),
          house: d.house,
          houseTunnel: houseRoute().tunnel,
          // Anyone else whose Groww key carries the house address: one
          // address per client, so this is a problem to be shown, not a
          // tidy "held by".
          houseAlso: d.house ? holdersOf(d.house) : [],
          accounts: d.users
            .filter((u) => u.hasBroker)
            .map((u) => ({ id: u.id, email: u.email, ip: u.brokerStaticIp, ucc: u.brokerUcc })),
        });
      }

      case "access":
        return json({ entries: d.access.map((a) => ({ ...a, email: d.who(a.userId) })) });

      // The live-trading console, as a READ.
      //
      // The website's page also places orders, sends them to many accounts at
      // once, exits positions and cancels working orders. None of that is
      // here, and not by oversight: those move real money in clients'
      // accounts, and this app's standing rule is that orders leave from the
      // desk. What an admin needs from a phone is to SEE what the strategy is
      // doing — which accounts are eligible, what went out today, whether the
      // loop is still ticking — and that is what this returns.
      case "live": {
        const now = istNow();
        const settings = await getSettings();
        const [day, orders, changes, today, checks, positions] = await Promise.all([
          getDay(now.day, now.date),
          ordersOfDay(now.day),
          recentChanges(12),
          liveToday().catch(() => null),
          // Same budget the web page uses: a slow broker must not hold the
          // whole console hostage, and an empty list is handled below.
          checkAccounts(settings, { maxAgeMs: 60_000, budgetMs: 4_000 }).catch(() => []),
          // The web polls this every 2 s from its own route. A phone cannot
          // poll like that without eating the battery, so it comes once with
          // the rest and carries the time it was read — a position list with
          // no timestamp is the kind of thing that gets acted on long after
          // it stopped being true.
          watchPositions().catch(() => []),
        ]);

        const name = new Map(checks.map((c) => [c.id, c.label]));
        const group = (g: string) => checks.filter((c) => c.group === g).length;

        return json({
          readOnly: true,
          settings: {
            mode: settings.mode,
            base: settings.base,
            excluded: settings.excluded.length,
            updatedAt: settings.updatedAt,
          },
          executor: executorStatus(),
          day: day && {
            date: day.date,
            mode: day.mode,
            base: day.base,
            accounts: day.accounts?.length ?? null,
            fixedAt: day.fixedAt,
            legs: day.legs,
            // The day's four steps and when each finished, so the app can show
            // the same ordered list the page does rather than a bare count.
            done: day.done,
            signals: day.signals,
            notes: day.notes,
          },
          // The research pick for today, so the orders below have something to
          // be read against.
          today,
          accounts: {
            eligible: group("eligible"),
            low: group("low"),
            blocked: group("blocked"),
            excluded: group("excluded"),
            rows: checks.map((c) => ({
              id: c.id,
              label: c.label,
              owner: c.owner,
              group: c.group,
              canSend: c.canSend,
              signed: c.signed,
              agreement: c.agreement,
              excluded: c.excluded,
              reason: c.reason,
              funds: c.funds,
            })),
          },
          orders: orders.map((o) => ({
            ...o,
            who: name.get(o.accountId) ?? o.accountId,
            actionLabel: ACTION_LABEL[o.action] ?? o.action,
          })),
          // Every connected account's open positions, as last read from
          // Groww. `canExit` and the error are carried as they are: a stale
          // reading presented as current is how a closed position gets closed
          // twice.
          positions: positions.map((p) => ({
            id: p.id,
            label: p.label,
            canExit: p.canExit,
            at: p.at,
            error: p.error,
            rows: p.rows,
          })),
          // Account ids appear in the change log as {{acct:<id>}} tokens and
          // are named here, exactly as the web page names them — the log
          // itself never stores an email.
          changes: changes.map((c) => ({
            at: c.at,
            ip: c.ip,
            what: c.what.replace(/\{\{acct:([^}]+)\}\}/g, (_m, id: string) => name.get(id) ?? id),
          })),
        });
      }

      case "paper":
        return json({ live: await liveSummary().catch(() => null) });

      // The daily report — one trading day of the paper record, leg by leg.
      //
      // The web page is a printable A4 landscape table. That cannot survive a
      // phone screen, so the app gets the same figures as rows it can stack,
      // and the printable sheet stays on the website. Nothing is recomputed
      // here: every number is read straight off the research box's record,
      // exactly as the page does.
      case "report": {
        const state = await liveSummary().catch(() => null);
        if (!state || state.kind !== "ok" || !state.data.livex) {
          return json({
            ok: false,
            reason:
              state == null
                ? "Research box unreachable."
                : state.kind === "unconfigured"
                  ? "Research box not configured."
                  : state.kind === "error"
                    ? `Research box unreachable: ${state.message}`
                    : (state.data.livex_error ?? "No paper record yet."),
          });
        }

        const r = state.data.livex;
        const days = [...r.days_all].sort((a, b) => b.day - a.day);
        const want = new URL(req.url).searchParams.get("day");
        const chosen = (want && days.find((x) => dayToIso(x.day) === want)) || days[0];
        if (!chosen) {
          return json({
            ok: false,
            reason:
              "No session recorded yet — the first pick is stored at 09:20 on the next trading day.",
          });
        }

        const iso = dayToIso(chosen.day);
        const legsA = r.trades.filter((t) => t.day === chosen.day);
        const sl05 = state.data.sl05;
        const closedB = (sl05?.trades ?? []).filter((t) => t.day === iso);
        // A running session's open leg exists only in sl05.today, never in the
        // stored trades — so it is marked open rather than shown as a result.
        const openB: (Sl05Trade & { open?: boolean })[] =
          chosen.day === (r.today?.day ?? null)
            ? (sl05?.today ?? [])
                .filter((t) => !closedB.some((cl) => cl.leg === t.leg))
                .map((t) => ({ ...t, day: iso, net: t.net ?? 0, open: t.net == null }))
            : [];
        const legsB: (Sl05Trade & { open?: boolean })[] = [...closedB, ...openB];

        return json({
          ok: true,
          day: {
            iso,
            status: chosen.status,
            skip: chosen.skip,
            pick: chosen.pick,
            flipSymbol: chosen.flip_symbol,
            settledAt: chosen.settled_at,
            isToday: chosen.day === (r.today?.day ?? null),
          },
          days: days.slice(0, 60).map((x) => ({ iso: dayToIso(x.day), status: x.status, skip: x.skip })),
          bookA: {
            served: r.trades_from == null || chosen.day >= r.trades_from,
            legs: legsA,
            net: legsA.reduce((t, x) => t + x.net, 0),
            costs: legsA.reduce((t, x) => t + x.costs, 0),
          },
          bookB: {
            served: sl05?.trades_from == null || chosen.day >= sl05.trades_from,
            legs: legsB,
            net: legsB.reduce((t, x) => t + x.net, 0),
            openLegs: legsB.filter((x) => x.open).length,
          },
          monthPct: r.per_month_pct[iso.slice(0, 7)] ?? null,
        });
      }

      default:
        return fail(`Unknown view "${view}".`, 400);
    }
  });
}


/**
 * POST /api/mobile/admin — the console's write actions.
 *
 * These call the SAME server actions the web console's forms post to, rather
 * than reimplementing them. That is the whole point: each one carries
 * validation, a notification to the client, and in some cases an audit entry,
 * and a second copy of that logic here would drift until the phone and the
 * website disagreed about what an admin had actually done.
 *
 * Every action re-checks `requireAdmin()` itself against the session cookie,
 * so the role check below is a gate, not the boundary.
 *
 * `adminOpenAccount` is deliberately NOT here. It does not change a record —
 * it swaps the admin's session for the client's and redirects into the member
 * site for an hour. Exposing it as a JSON call would hand back a redirect the
 * app has no session model for, and would log an account as "opened" that
 * nobody was actually looking at. It stays on the web until the app can carry
 * an admin-acting-as-member session properly.
 */
export async function POST(req: Request) {
  return guarded(async (c) => {
    if (c.role !== "admin") return fail("The admin console is a separate sign-in.", 403);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return fail("Expected a JSON body.", 400);
    }

    const str = (k: string) => String(body[k] ?? "");
    const form = (pairs: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(pairs)) f.append(k, v);
      return f;
    };

    switch (str("action")) {
      case "disconnect-broker":
        await adminDisconnectBroker(form({ userId: str("userId") }));
        break;

      case "delete-user":
        await adminDeleteUser(form({ userId: str("userId") }));
        break;

      case "kyc-decision":
        await adminKycDecision(
          form({ userId: str("userId"), decision: str("decision"), notes: str("notes") }),
        );
        break;

      case "kyc-call":
        await adminScheduleKycCall(
          form({ userId: str("userId"), callAt: str("callAt"), callLink: str("callLink") }),
        );
        break;

      case "mark-invoice":
        await adminMarkInvoice(form({ id: str("id"), status: str("status") }));
        break;

      case "add-address":
        await adminAddEgress(
          form({ ip: str("ip"), proxy: str("proxy"), note: str("note") }),
        );
        break;

      case "remove-address":
        await adminRemoveEgress(form({ ip: str("ip") }));
        break;

      default:
        return fail(`Unknown action "${str("action")}".`, 400);
    }

    // The actions return void and simply do nothing when a request does not
    // pass their own checks — exactly as on the web, where the page then
    // re-renders unchanged. So this does not claim the act succeeded; the app
    // reloads the section and shows whatever the record now actually says.
    return json({ done: true });
  });
}
