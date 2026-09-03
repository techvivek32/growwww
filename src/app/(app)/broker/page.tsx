import type { Metadata } from "next";
import { ACCOUNT, OPENING_CAPITAL, TOTAL_NET, RETURN_PCT, TRADES } from "@/lib/book";
import { fmtMoney, fmtMoneySigned, fmtPct } from "@/lib/format";
import { PageHead, Card, CardHead, Pill, Button } from "@/components/ui";

export const metadata: Metadata = { title: "Broker · MNHA Financials" };

/* -------------------------------------------------------------- icon bits */

function Check() {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brandsoft text-brandtext">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    </span>
  );
}

function Arrow() {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-violetsoft text-violet">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h13M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/* -------------------------------------------------------------------- data */

const RUNNING_ON = [
  {
    label: "Real NSE prices",
    detail:
      "Live quotes for every .NS symbol and index, refreshed every 5 minutes. Delayed, which is why execution waits for Groww.",
  },
  {
    label: "Paper order book",
    detail:
      "Orders, positions and P&L are kept locally. Nothing reaches an exchange and no real money can move.",
  },
  {
    label: "IST session clock",
    detail: "09:15–15:30 Asia/Kolkata with a 09:00 pre-open. No extended hours, because NSE has none.",
  },
  {
    label: "Lot-aware F&O",
    detail: "Index option quantities are always whole lots, sized against the per-trade risk limit.",
  },
];

const UNLOCKS = [
  { label: "Live order placement", detail: "MARKET, LIMIT, SL and SL_M across CNC, MIS and NRML." },
  { label: "Real-time market data", detail: "Groww's WebSocket feed, up to 1,000 instruments." },
  { label: "Positions and holdings", detail: "Read straight from your Groww account instead of the paper book." },
  { label: "Verified fills", detail: "Every submission read back from the broker before it is shown as placed." },
];

const CAPABILITIES = [
  { k: "Order types", v: "MARKET · LIMIT · SL · SL_M" },
  { k: "Products", v: "CNC · MIS · NRML" },
  { k: "Stop + target", v: "GTT + OCO pair (no bracket orders)" },
  { k: "Rate limit", v: "10/s · 250/min on orders" },
  { k: "Live data", v: "WebSocket, up to 1,000 instruments" },
  { k: "Subscription", v: "₹499 + GST per month" },
];

export default function BrokerPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Broker" sub="How MNHA Financials connects to your Groww account." />

      <Card className="mb-5">
        <CardHead title="Groww" sub={ACCOUNT.name} right={<Pill tone="brand">Paper mode</Pill>} />

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

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button>Connect Groww account</Button>
          <p className="text-[12px] leading-relaxed text-ink3">
            Takes about ten minutes. Until then everything runs on the paper book.
          </p>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHead
          title="Running today"
          sub={`Paper mode on real market data — ${TRADES.length} round-trips recorded so far`}
        />
        <ul className="space-y-3.5">
          {RUNNING_ON.map((r) => (
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
        <CardHead title="Connecting adds" sub="Everything above keeps working — this is what gets added" />
        <ul className="space-y-3.5">
          {UNLOCKS.map((r) => (
            <li key={r.label} className="flex gap-3">
              <Arrow />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{r.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">{r.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-5">
        <CardHead title="How the Groww API works" sub="The constraints the order desk is built around" />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.k} className="border-b border-line pb-3 last:border-0">
              <dt className="text-[11px] tracking-wider text-ink3 uppercase">{c.k}</dt>
              <dd className="mt-0.5 text-[13px] font-medium text-ink">{c.v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line pt-4 text-[12px] leading-relaxed text-ink3">
          Orders are placed from a fixed server address registered with Groww, as SEBI requires for API trading —
          never from the browser. Access tokens are minted on that server from a TOTP secret and refreshed
          pre-market, so nothing needs a human at 6 AM.
        </p>
      </Card>

      <Card>
        <CardHead title="Trading mode" sub="Paper is the default and stays the default until you connect" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-[13px] font-semibold text-white">
            Paper
          </span>
          <span className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-[13px] font-medium text-ink3">
            Live
          </span>
          <p className="ml-1 text-[12px] text-ink3">Live turns on once the account is connected.</p>
        </div>
      </Card>
    </div>
  );
}
