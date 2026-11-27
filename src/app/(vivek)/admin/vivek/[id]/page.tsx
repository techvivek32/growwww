import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/access";
import { isReservedId } from "@/lib/auth";
import { Card } from "@/components/ui";
import { listUsers } from "@/lib/users";
import { kycNames } from "@/lib/kyc";
import { balanceRows, dayLines, dayShare, istDate } from "@/lib/balances";

export const metadata: Metadata = { title: "User · Vivek · MNHA Financials" };
export const dynamic = "force-dynamic";

/**
 * One user's money, day by day, opened from /admin/vivek. Every figure is Groww's own, read every
 * quarter hour by lib/balances:
 *  - the balance when Groww was linked, on one side;
 *  - per trading day: the balance it started with, the balance after Groww settled it, the difference
 *    (the day's P&L), and the owner's 40% share of a profit day.
 */

/** The owner's share of a day's profit (26 Nov 2026). Nothing on a loss day. */
const OUR_PCT = 40;

const IST = "Asia/Kolkata";
const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: IST });
const DAY_YR = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: IST });
const DAY_TIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${rs(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-ink2");
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A date `YYYY-MM-DD` shown as IST, read at noon so no zone can move it to another day. */
const dayOf = (iso: string) => DAY.format(new Date(`${iso}T12:00:00+05:30`));

/** Everything the page shows, read and worked out once, at request time. */
async function load(userId: string) {
  const user = (await listUsers()).find((u) => u.id === userId);
  if (!user || isReservedId(user.id)) return null;
  const now = Date.now();
  const [rows, names] = await Promise.all([balanceRows(user.id), kycNames()]);
  const days = dayLines(rows, now);
  const linked = rows.find((r) => r.why === "linked") ?? null;
  const first = rows[0] ?? null;
  const latest = rows.length ? rows[rows.length - 1] : null;
  const base = linked ?? first;
  const settled = days.filter((d) => d.pnl !== null);
  return {
    user,
    rows,
    name: names.get(user.id) ?? null,
    days,
    linked,
    first,
    latest,
    above: latest && base ? round2(latest.cash - base.cash) : null,
    settled,
    totalPnl: round2(settled.reduce((t, d) => t + (d.pnl as number), 0)),
    totalFee: round2(settled.reduce((t, d) => t + dayShare(d, OUR_PCT), 0)),
    today: istDate(now),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { user, rows, name, days, linked, first, latest, above, settled, totalPnl, totalFee, today } = data;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/admin/vivek" className="text-[13px] font-medium text-ink2 hover:text-ink">
        ← Users
      </Link>
      <h1 className="pub-display mt-3 text-[28px] leading-tight break-all text-ink sm:text-[34px]">{user.email}</h1>
      {name && <p className="mt-1 text-[13px] text-ink3">{name}</p>}

      {!user.hasBroker && !rows.length ? (
        <Card className="mt-6">
          <p className="text-[13.5px] text-ink2">Groww is not connected, so there is no balance to read.</p>
        </Card>
      ) : (
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
          {/* The side figures: first on a phone, on the right on a wide screen. */}
          <aside className="lg:order-2">
            <Card>
              <Fig label="When linked">
                {linked ? (
                  <>
                    <p className="tnum text-[20px] font-semibold text-ink">{rs(linked.cash)}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink3">{DAY_TIME.format(new Date(linked.at))}</p>
                  </>
                ) : (
                  <>
                    <p className="text-[13px] text-ink2">Not recorded</p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink3">
                      {user.brokerConnectedAt ? `Linked ${DAY_YR.format(new Date(user.brokerConnectedAt))}, before MNHA kept balances.` : "Linked before MNHA kept balances."}
                      {first && ` First reading: ${rs(first.cash)} on ${DAY_YR.format(new Date(first.at))}.`}
                    </p>
                  </>
                )}
              </Fig>
              <Fig label="Balance now">
                {latest ? (
                  <>
                    <p className="tnum text-[20px] font-semibold text-ink">{rs(latest.cash)}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink3">Groww clear cash · {DAY_TIME.format(new Date(latest.at))}</p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink3">No reading yet</p>
                )}
              </Fig>
              {above !== null && (
                <Fig label={linked ? "Above the linked balance" : "Above the first reading"}>
                  <p className={`tnum text-[20px] font-semibold ${tone(above)}`}>{signed(above)}</p>
                </Fig>
              )}
              <Fig label="Total P&L (settled days)">
                <p className={`tnum text-[20px] font-semibold ${tone(totalPnl)}`}>{settled.length ? signed(totalPnl) : "—"}</p>
              </Fig>
              <Fig label={`Our ${OUR_PCT}% (profit days)`} last>
                <p className="tnum text-[20px] font-semibold text-ink">{settled.length ? rs(totalFee) : "—"}</p>
              </Fig>
            </Card>
          </aside>

          <section className="min-w-0 lg:order-1">
            <Card pad={false}>
              {days.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13.5px] text-ink3">
                  No balance reading yet. MNHA reads Groww every 15 minutes; the first one appears shortly.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                        <th className="px-4 py-3 font-medium">Day</th>
                        <th className="px-4 py-3 text-right font-medium">Day start</th>
                        <th className="px-4 py-3 text-right font-medium">After settlement</th>
                        <th className="px-4 py-3 text-right font-medium">P&amp;L</th>
                        <th className="px-4 py-3 text-right font-medium">Our {OUR_PCT}%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date} className="border-b border-line align-top last:border-0">
                          <td className="px-4 py-2.5 text-[12.5px] whitespace-nowrap text-ink">
                            {dayOf(d.date)}
                            {d.date === today && <span className="ml-1.5 text-[11px] text-ink3">today</span>}
                          </td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] whitespace-nowrap text-ink2">{d.start !== null ? rs(d.start) : "—"}</td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] whitespace-nowrap text-ink2">
                            {d.end !== null ? rs(d.end) : <span className="text-[11.5px] text-ink3">{d.start !== null ? "Not settled yet" : "—"}</span>}
                          </td>
                          <td className="tnum px-4 py-2.5 text-right whitespace-nowrap">
                            {d.pnl !== null ? <span className={`text-[13px] font-semibold ${tone(d.pnl)}`}>{signed(d.pnl)}</span> : <span className="text-[12.5px] text-ink3">—</span>}
                            {d.realised !== null && d.realised !== 0 && (
                              <p className={`mt-0.5 text-[11px] ${d.pnl === null ? tone(d.realised) : "text-ink3"}`} title="Groww's realised P&L for the day, before brokerage and charges.">
                                Groww {signed(d.realised)} before charges
                              </p>
                            )}
                            {d.unexplained !== null && (
                              <p
                                className="mt-0.5 text-[11px] font-medium text-warn"
                                title="Trading alone cannot raise the balance more than the trades made. Money paid in is not profit: our share is worked out on the trades' part only. Check in Groww."
                              >
                                {signed(d.unexplained)} not from trades: a deposit?
                              </p>
                            )}
                          </td>
                          <td className="tnum px-4 py-2.5 text-right text-[12.5px] whitespace-nowrap text-ink">
                            {d.pnl !== null ? (dayShare(d, OUR_PCT) ? rs(dayShare(d, OUR_PCT)) : "—") : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>
        </div>
      )}
    </main>
  );
}

/** One figure in the side card, with a hairline under all but the last. */
function Fig({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-4 border-b border-line pb-4"}>
      <p className="mb-1.5 font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">{label}</p>
      {children}
    </div>
  );
}
