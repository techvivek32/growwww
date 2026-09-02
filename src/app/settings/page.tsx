import type { Metadata } from "next";
import { ACCOUNT } from "@/lib/mock";
import { fmtMoney } from "@/lib/format";
import { PageHead, Card, CardHead, Pill, Button } from "@/components/ui";

export const metadata: Metadata = { title: "Broker & Settings · NOVA India" };

interface Check {
  label: string;
  state: "done" | "pending" | "blocked";
  detail: string;
}

const CHECKS: Check[] = [
  {
    label: "Groww API subscription",
    state: "pending",
    detail: "₹499 + GST per month. Unlocks orders, live data and historical candles.",
  },
  {
    label: "Static IP whitelisted",
    state: "pending",
    detail:
      "SEBI requires order placement from a registered static IP since 1 Apr 2026. Primary and secondary can be changed only once every 7 days.",
  },
  {
    label: "TOTP credentials",
    state: "pending",
    detail:
      "The TOTP flow lets the server mint its own access token. The access token still expires at 6:00 AM daily, so a pre-market refresh job runs at 08:30 IST.",
  },
  {
    label: "Order gateway on VPS",
    state: "pending",
    detail:
      "Orders must leave from the whitelisted IP, so they are placed by a gateway on the VPS — never from the browser and never from Vercel, whose egress IP is not fixed.",
  },
  {
    label: "Paper trading store",
    state: "done",
    detail: "Phase 1 runs entirely on sample NSE data with a local paper book. No real money can move.",
  },
];

const TONE = { done: "up", pending: "warn", blocked: "down" } as const;
const WORD = { done: "Ready", pending: "Pending", blocked: "Blocked" } as const;

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Broker & settings" sub="How NOVA India connects to your Groww account." />

      <Card className="mb-5">
        <CardHead
          title="Groww"
          sub={ACCOUNT.name}
          right={<Pill tone="warn">Paper mode</Pill>}
        />
        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Balance</dt>
            <dd className="tnum mt-1 text-[15px] font-semibold text-ink">{fmtMoney(ACCOUNT.balance)}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Exchange</dt>
            <dd className="mt-1 text-[15px] font-semibold text-ink">NSE</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Session</dt>
            <dd className="mt-1 text-[15px] font-semibold text-ink">09:15–15:30 IST</dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-5">
        <CardHead
          title="Go-live checklist"
          sub="Everything that must be true before a real order can be placed."
        />
        <ul className="space-y-3">
          {CHECKS.map((c) => (
            <li key={c.label} className="flex gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
              <span className="mt-0.5 shrink-0">
                <Pill tone={TONE[c.state]}>{WORD[c.state]}</Pill>
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{c.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="Trading mode" />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm">Paper</Button>
          <Button variant="ghost" size="sm">Live</Button>
          <p className="text-[12px] text-ink3">
            Live stays disabled until every item above reads Ready.
          </p>
        </div>
      </Card>
    </div>
  );
}
