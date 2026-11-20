import { loadAdmin } from "@/app/(admin)/admin/sections";
import { liveSummary } from "@/lib/research";
import { AGREEMENT_VERSION } from "@/lib/consent";
import { json, guarded, fail } from "@/lib/mobileApi";

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
          recentAccess: d.access.slice(0, 8),
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

      case "addresses":
        return json({
          pool: d.pool,
          house: d.house,
          accounts: d.users
            .filter((u) => u.hasBroker)
            .map((u) => ({ id: u.id, email: u.email, ip: u.brokerStaticIp, ucc: u.brokerUcc })),
        });

      case "access":
        return json({ entries: d.access.map((a) => ({ ...a, email: d.who(a.userId) })) });

      case "paper":
        return json({ live: await liveSummary().catch(() => null) });

      default:
        return fail(`Unknown view "${view}".`, 400);
    }
  });
}
