import type { Metadata } from "next";
import {
  ACCOUNT,
  OPENING_CAPITAL,
  TOTAL_NET,
  TOTAL_CHARGES,
  RETURN_PCT,
  TRADES,
  ORDERS,
  SESSIONS,
} from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct, fmtNum } from "@/lib/format";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Broker · MNHA Financials" };

function Check() {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-upsoft text-up">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

const CONNECTION = [
  {
    label: "Order placement",
    detail:
      "MARKET, LIMIT, SL and SL_M across CNC, MIS and NRML. Every submission is read back from the broker and verified before it is shown as placed.",
  },
  {
    label: "Real-time NSE data",
    detail: "Quotes and depth streaming over the WebSocket feed, up to 1,000 instruments at once.",
  },
  {
    label: "Registered static IP",
    detail:
      "Orders leave from the gateway address registered with Groww, as SEBI requires for API trading — never from the browser.",
  },
  {
    label: "Automatic token refresh",
    detail: `Access tokens expire at 06:00 IST daily and are re-minted from the TOTP secret on the gateway. Last refresh ${ACCOUNT.tokenRefreshedAt}.`,
  },
  {
    label: "Stop and target on every fill",
    detail:
      "Groww has no bracket orders, so each entry is paired with a GTT + OCO stop and target. Filling one cancels the other.",
  },
];

const LIMITS = [
  { k: "Order types", v: "MARKET · LIMIT · SL · SL_M" },
  { k: "Products", v: "CNC · MIS · NRML" },
  { k: "Stop + target", v: "GTT + OCO pair" },
  { k: "Order rate limit", v: "10/s · 250/min" },
  { k: "Data rate limit", v: "10/s · 300/min" },
  { k: "Streaming", v: "Up to 1,000 instruments" },
];

export default function BrokerPage() {
  const filled = ORDERS.filter((o) => o.status === "COMPLETE").length;
  const turnover = TRADES.reduce((s, t) => s + (t.entry + t.exit) * t.qty, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Broker" sub="How MNHA Financials connects to your Groww account." />

      <Card className="mb-5">
        <CardHead
          title="Groww"
          sub={ACCOUNT.name}
          right={
            <Pill tone="up">
              <span className="live-dot mr-0.5 h-1.5 w-1.5 rounded-full bg-up" />
              Live
            </Pill>
          }
        />

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
        <CardHead title="Connection" sub="Everything the order desk needs is up" />
        <ul className="space-y-3.5">
          {CONNECTION.map((r) => (
            <li key={r.label} className="flex gap-3">
              <Check />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{r.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">{r.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-5">
        <CardHead
          title="Execution so far"
          sub={`${SESSIONS.length} sessions · ${ACCOUNT.windowLabel}`}
        />
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { k: "Orders filled", v: fmtNum(filled) },
            { k: "Round-trips", v: fmtNum(TRADES.length) },
            { k: "Turnover", v: fmtMoney(turnover, 0) },
            { k: "Charges", v: fmtMoney(TOTAL_CHARGES, 0) },
          ].map((x) => (
            <div key={x.k}>
              <dt className="text-[11px] tracking-wider text-ink3 uppercase">{x.k}</dt>
              <dd className="tnum mt-1 text-[15px] font-semibold text-ink">{x.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line pt-4 text-[12px] leading-relaxed text-ink3">
          Charges are brokerage, STT, exchange fees, GST, SEBI turnover fees and stamp duty, deducted
          by Groww. Realised P&amp;L above is net of all of them.
        </p>
      </Card>

      <Card>
        <CardHead title="API limits" sub="What the order desk paces itself against" />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {LIMITS.map((c) => (
            <div key={c.k} className="border-b border-line pb-3 last:border-0">
              <dt className="text-[11px] tracking-wider text-ink3 uppercase">{c.k}</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-ink">{c.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
