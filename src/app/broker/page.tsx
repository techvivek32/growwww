import type { Metadata } from "next";
import { ACCOUNT, OPENING_CAPITAL, TOTAL_NET, RETURN_PCT } from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct } from "@/lib/format";
import { PageHead, Card, CardHead, Pill, Button } from "@/components/ui";

export const metadata: Metadata = { title: "Broker · MNHA Financials" };

interface Check {
  label: string;
  state: "done" | "pending" | "blocked";
  detail: string;
}

const CHECKS: Check[] = [
  {
    label: "Groww API subscription",
    state: "pending",
    detail: "₹499 + GST per month. Unlocks order placement, live data and historical candles.",
  },
  {
    label: "Static IP whitelisted",
    state: "pending",
    detail:
      "SEBI has required order placement from a registered static IP since 1 Apr 2026. Primary and secondary can be changed only once every 7 days, so the address is verified on the box before it is registered.",
  },
  {
    label: "TOTP credentials",
    state: "pending",
    detail:
      "The TOTP flow lets the server mint its own access token. The token still expires at 06:00 IST daily, so a refresh job runs pre-market at 08:30.",
  },
  {
    label: "Order gateway on VPS",
    state: "pending",
    detail:
      "Orders must leave from the whitelisted IP, so a gateway on the VPS places them — never the browser, and never a serverless function whose egress IP is not fixed.",
  },
  {
    label: "Paper trading store",
    state: "done",
    detail: "Phase 1 runs on real delayed NSE prices from Yahoo with a local paper book. No real money can move.",
  },
];

const TONE = { done: "up", pending: "warn", blocked: "down" } as const;
const WORD = { done: "Ready", pending: "Pending", blocked: "Blocked" } as const;

const CAPABILITIES = [
  { k: "Order types", v: "MARKET · LIMIT · SL · SL_M" },
  { k: "Products", v: "CNC · MIS · NRML" },
  { k: "Brackets", v: "None — emulated with GTT + OCO" },
  { k: "Rate limit", v: "10/s · 250/min on orders" },
  { k: "Live data", v: "WebSocket, up to 1,000 instruments" },
  { k: "Token life", v: "Expires 06:00 IST daily" },
];

export default function BrokerPage() {
  const ready = CHECKS.filter((c) => c.state === "done").length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Broker" sub="How MNHA Financials connects to your Groww account." />

      <Card className="mb-5">
        <CardHead title="Groww" sub={ACCOUNT.name} right={<Pill tone="warn">Paper mode</Pill>} />
        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Balance</dt>
            <dd className="tnum mt-1 text-[15px] font-semibold text-ink">{fmtMoney(ACCOUNT.balance)}</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Realised P&amp;L</dt>
            <dd className="tnum mt-1 text-[15px] font-semibold text-up">
              {fmtMoneySigned(TOTAL_NET, 0)}
              <span className="block text-[11px] font-normal text-ink3">
                {fmtMoney(OPENING_CAPITAL, 0)} start · {fmtPct(RETURN_PCT)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Exchange</dt>
            <dd className="mt-1 text-[15px] font-semibold text-ink">NSE</dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wider text-ink3 uppercase">Session</dt>
            <dd className="mt-1 text-[15px] font-semibold text-ink">09:15–15:30</dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-5">
        <CardHead
          title="Go-live checklist"
          sub={`${ready} of ${CHECKS.length} ready — everything must pass before a real order can be placed`}
        />
        <ul className="space-y-3">
          {CHECKS.map((c) => (
            <li key={c.label} className="flex gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
              <span className="mt-0.5 w-[68px] shrink-0">
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

      <Card className="mb-5">
        <CardHead title="What the Groww API allows" sub="Constraints the order desk is built around" />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.k} className="border-b border-line pb-3 last:border-0">
              <dt className="text-[11px] tracking-wider text-ink3 uppercase">{c.k}</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-ink">{c.v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card>
        <CardHead title="Trading mode" />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm">Paper</Button>
          <Button variant="ghost" size="sm">Live</Button>
          <p className="text-[12px] text-ink3">Live stays disabled until every item above reads Ready.</p>
        </div>
      </Card>
    </div>
  );
}
