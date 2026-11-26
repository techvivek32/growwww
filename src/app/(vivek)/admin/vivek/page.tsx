import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { Card, Pill } from "@/components/ui";
import { listUsers } from "@/lib/users";
import { orderStatsByUser } from "@/lib/ledger";
import { kycNames } from "@/lib/kyc";

export const metadata: Metadata = { title: "Vivek · MNHA Financials" };
export const dynamic = "force-dynamic";

/**
 * The owner's own page (/admin/vivek, opened by its address, not from the menu): every user in short,
 * filtered into those whose Groww account has traded through MNHA and those whose has not.
 *
 * A page of its own: it sits outside the (admin) route group, so it has none of the console's header
 * or sidebar (the owner asked for nothing but the list). Its URL is still under /admin, so the proxy
 * lets only the admin login in, and requireAdminPage() below checks again.
 *
 * "Traded" means Groww accepted at least one order MNHA sent into that account (the user's own, the
 * admin's, or the strategy's), from MNHA's order log. It is the same test as the dashboard's "Placed ≥1
 * order" step, over every user; the funnel also needs a signed agreement and a connected Groww, so its
 * number can be lower. A rejected order is not a trade. An "unknown" one (the send did not complete, so
 * Groww may or may not have it) is not counted either, but is shown, so the owner can check it in Groww.
 * Fills and money live at Groww.
 */

type Show = "all" | "traded" | "not-traded";

const IST = "Asia/Kolkata";
const DAY = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "2-digit", timeZone: IST });
const DAY_TIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });

const FILTERS: { key: Show; label: string; href: string }[] = [
  { key: "all", label: "All", href: "/admin/vivek" },
  { key: "traded", label: "Traded", href: "/admin/vivek?show=traded" },
  { key: "not-traded", label: "Not traded", href: "/admin/vivek?show=not-traded" },
];

export default async function Page({ searchParams }: { searchParams: Promise<{ show?: string | string[] }> }) {
  await requireAdminPage();
  const { show: raw } = await searchParams;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const show: Show = asked === "traded" || asked === "not-traded" ? asked : "all";

  const [users, stats, nameFor] = await Promise.all([listUsers(), orderStatsByUser({ strict: true }), kycNames()]);

  const rows = users
    .map((u) => {
      const s = stats.get(u.id);
      const placed = s?.placed ?? 0;
      return {
        id: u.id,
        email: u.email,
        name: nameFor.get(u.id) ?? null,
        joined: u.createdAt,
        groww: u.hasBroker,
        placed,
        rejected: s?.rejected ?? 0,
        unknown: s?.unknown ?? 0,
        lastAt: s?.lastAt ?? null,
        traded: placed > 0,
      };
    })
    // Latest order first; users with no order after them, newest sign-up first.
    .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || b.joined - a.joined);

  const count: Record<Show, number> = {
    all: rows.length,
    traded: rows.filter((r) => r.traded).length,
    "not-traded": rows.filter((r) => !r.traded).length,
  };
  const shown = show === "all" ? rows : rows.filter((r) => (show === "traded" ? r.traded : !r.traded));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="pub-display mb-6 text-[34px] leading-none text-ink sm:text-[40px]">Users</h1>

      <nav aria-label="Filter users" className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const on = f.key === show;
          return (
            <Link
              key={f.key}
              href={f.href}
              aria-current={on ? "page" : undefined}
              className={`inline-flex h-9 items-center border px-3.5 text-[13px] font-medium transition-colors ${
                on ? "border-brand bg-brand text-onbrand" : "border-line text-ink2 hover:bg-surfaceh hover:text-ink"
              }`}
            >
              {f.label}
              <span className={`tnum ml-2 font-mono text-[11px] ${on ? "opacity-70" : "text-ink3"}`}>{count[f.key]}</span>
            </Link>
          );
        })}
      </nav>

      <Card pad={false}>
        {shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13.5px] text-ink3">
            {rows.length === 0 ? "No users yet." : show === "traded" ? "No user has traded yet." : "Every user has traded."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="w-10 px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Trade</th>
                  <th className="px-4 py-3 font-medium">Groww</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Last order (IST)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const counts = [
                    r.placed > 0 && { text: `${r.placed} placed`, tone: "text-ink2", title: undefined },
                    r.rejected > 0 && { text: `${r.rejected} rejected`, tone: "text-warn", title: undefined },
                    r.unknown > 0 && {
                      text: `${r.unknown} unconfirmed`,
                      tone: "text-warn",
                      title: "The send did not complete, so Groww may or may not have these orders: check them in Groww.",
                    },
                  ].filter((c): c is { text: string; tone: string; title: string | undefined } => Boolean(c));
                  return (
                    <tr key={r.id} className="border-b border-line transition-colors last:border-0 hover:bg-surfaceh">
                      <td className="tnum px-4 py-2.5 align-top text-[12px] text-ink3">{i + 1}</td>
                      <td className="max-w-[260px] px-4 py-2.5 align-top">
                        <Link
                          href={`/admin/vivek/${encodeURIComponent(r.id)}`}
                          className="block truncate text-[13px] font-medium text-ink underline decoration-line2 underline-offset-4 hover:decoration-ink"
                          title={`${r.email}: open day-by-day P&L`}
                        >
                          {r.email}
                        </Link>
                        {r.name && <p className="truncate text-[11.5px] text-ink3" title={r.name}>{r.name}</p>}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap">
                        {r.traded ? (
                          <Pill tone="up">
                            <span title="Groww accepted at least one order MNHA sent into this account. Accepted is not always filled: fills are in Groww.">Traded</span>
                          </Pill>
                        ) : (
                          <Pill tone="neutral">Not traded</Pill>
                        )}
                        {counts.length > 0 && (
                          <p className="tnum mt-1 text-[11.5px]">
                            {counts.map((c, k) => (
                              <span key={c.text} className={`${c.tone} ${k ? "ml-2" : ""}`} title={c.title}>
                                {c.text}
                              </span>
                            ))}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap">
                        {r.groww ? <Pill tone="up">Connected</Pill> : <Pill tone="neutral">Not connected</Pill>}
                      </td>
                      <td className="tnum px-4 py-2.5 align-top text-[12px] whitespace-nowrap text-ink2">{DAY.format(new Date(r.joined))}</td>
                      <td className="tnum px-4 py-2.5 align-top text-[12px] whitespace-nowrap text-ink2">{r.lastAt ? DAY_TIME.format(new Date(r.lastAt)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
