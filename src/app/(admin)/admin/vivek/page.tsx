import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/lib/access";
import { Card, PageHead, Pill } from "@/components/ui";
import { listUsers } from "@/lib/users";
import { orderStatsByUser } from "@/lib/ledger";
import { kycNames } from "@/lib/kyc";

export const metadata: Metadata = { title: "Vivek · Admin · MNHA Financials" };
export const dynamic = "force-dynamic";

/**
 * The owner's own page (/admin/vivek, opened by its address, not from the menu): every user in short,
 * filtered into those whose Groww account has traded through MNHA and those whose has not.
 *
 * "Traded" means Groww accepted at least one order MNHA sent into that account (the user's own, the
 * admin's, or the strategy's): MNHA's order log, the same count as the dashboard's "Placed ≥1 order".
 * A rejected order is not a trade. Fills and money live at Groww.
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

  const [users, stats, nameFor] = await Promise.all([listUsers(), orderStatsByUser(), kycNames()]);

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
    <div className="mx-auto max-w-6xl">
      <PageHead title="Users" sub="Every user in short. Filter who has traded through MNHA and who has not." right={<Pill tone="violet">Admin</Pill>} />

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
            {show === "traded" ? "No user has traded yet." : show === "not-traded" ? "Every user has traded." : "No users yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
                  <th className="w-10 px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Groww</th>
                  <th className="px-4 py-3 font-medium">Trade</th>
                  <th className="px-4 py-3 text-right font-medium">Orders</th>
                  <th className="px-4 py-3 font-medium">Last order (IST)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="tnum px-4 py-2.5 text-[12px] text-ink3">{i + 1}</td>
                    <td className="max-w-[280px] px-4 py-2.5">
                      <p className="truncate text-[13px] text-ink" title={r.email}>{r.email}</p>
                      {r.name && <p className="truncate text-[11.5px] text-ink3" title={r.name}>{r.name}</p>}
                    </td>
                    <td className="tnum px-4 py-2.5 text-[12px] whitespace-nowrap text-ink2">{DAY.format(new Date(r.joined))}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.groww ? <Pill tone="up">Connected</Pill> : <Pill tone="neutral">Not connected</Pill>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r.traded ? <Pill tone="up">Traded</Pill> : <Pill tone="neutral">Not traded</Pill>}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-[12.5px] whitespace-nowrap">
                      {r.placed > 0 ? <span className="text-ink">{r.placed} placed</span> : <span className="text-ink3">—</span>}
                      {r.rejected > 0 && <span className="ml-2 text-[11.5px] text-warn">{r.rejected} rejected</span>}
                    </td>
                    <td className="tnum px-4 py-2.5 text-[12px] whitespace-nowrap text-ink2">{r.lastAt ? DAY_TIME.format(new Date(r.lastAt)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-[11.5px] leading-relaxed text-ink3">
        Traded: Groww accepted at least one order MNHA sent into the account: the user&apos;s own, the admin&apos;s, or the
        strategy&apos;s. A rejected order is not a trade. From MNHA&apos;s order log; fills and money are at Groww.
      </p>
    </div>
  );
}
