import type { Metadata } from "next";
import { getAccount, isConnected } from "@/lib/api/broker";
import { PageHead, Card, CardHead, Pill, Button } from "@/components/ui";

export const metadata: Metadata = { title: "Broker · MNHA Financials" };

function Dot({ on }: { on: boolean }) {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface2 text-ink3">
      {on ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--c-up)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-ink3" />
      )}
    </span>
  );
}

const STEPS = [
  {
    label: "Trading API subscription",
    detail: "₹499 + GST per month on the Groww Cloud console. Unlocks order placement, the live feed and historical candles.",
  },
  {
    label: "Static IP registered",
    detail:
      "SEBI has required order placement from a registered IP since 1 Apr 2026. It can be changed only once every 7 days, so the address is verified on the host before it is registered.",
  },
  {
    label: "TOTP credentials",
    detail:
      "The TOTP flow lets the gateway mint its own access token. Tokens expire at 06:00 IST daily and are re-minted pre-market, so nothing needs a human at 6 AM.",
  },
  {
    label: "Order gateway reachable",
    detail:
      "Orders must leave from the registered IP, so a gateway on that host places them — never the browser, and never a serverless function whose egress IP is not fixed.",
  },
];

const LIMITS = [
  { k: "Order types", v: "MARKET · LIMIT · SL · SL_M" },
  { k: "Products", v: "CNC · MIS · NRML" },
  { k: "Stop + target", v: "GTT + OCO pair (no bracket orders)" },
  { k: "Order rate limit", v: "10/s · 250/min" },
  { k: "Data rate limit", v: "10/s · 300/min" },
  { k: "Streaming", v: "Up to 1,000 instruments" },
];

export default async function BrokerPage() {
  const account = await getAccount();
  const connected = isConnected();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Broker" sub="How MNHA Financials connects to your Groww account." />

      <Card className="mb-5">
        <CardHead
          title="Groww"
          sub={account.email}
          right={<Pill tone={connected ? "up" : "neutral"}>{connected ? "Connected" : "Not connected"}</Pill>}
        />

        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] text-ink3">Account</dt>
            <dd className="mt-1 text-[14.5px] font-semibold text-ink">{account.name}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Balance</dt>
            <dd className="tnum mt-1 text-[14.5px] font-semibold text-ink3">
              {account.balance === null ? "—" : account.balance}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Exchange</dt>
            <dd className="mt-1 text-[14.5px] font-semibold text-ink">NSE</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Session</dt>
            <dd className="mt-1 text-[14.5px] font-semibold text-ink">09:15–15:30</dd>
          </div>
        </dl>

        {!connected && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button>Connect Groww account</Button>
            <p className="text-[12.5px] leading-relaxed text-ink3">
              Balances, holdings, positions and orders all read from Groww. Until then those screens stay empty
              rather than showing a number nobody can stand behind.
            </p>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <CardHead title="What connecting needs" sub="Four things, in this order" />
        <ul className="space-y-3.5">
          {STEPS.map((s) => (
            <li key={s.label} className="flex gap-3">
              <Dot on={connected} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-ink">{s.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink3">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="How the Groww API works" sub="The constraints the order desk is built around" />
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {LIMITS.map((c) => (
            <div key={c.k} className="border-b border-line pb-3 last:border-0">
              <dt className="text-[12px] text-ink3">{c.k}</dt>
              <dd className="mt-0.5 text-[13.5px] font-medium text-ink">{c.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
