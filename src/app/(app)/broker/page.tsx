import type { Metadata } from "next";
import { getAccount, getConnectionStatus } from "@/lib/api/broker";
import { fmtMoney } from "@/lib/format";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Broker · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

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

/** Each row's tick reflects a distinct, verifiable fact — not one boolean. */
function buildSteps(status: { credentials: boolean; live: boolean; ipPinned: boolean }) {
  return [
    {
      on: status.credentials,
      label: "API credentials configured",
      detail: "GROWW_API_KEY and the TOTP secret are set on the server.",
    },
    {
      on: status.live,
      label: "Live API call verified",
      detail:
        "A TOTP-authenticated request to Groww succeeded just now — which also proves the ₹499/month API subscription is active.",
    },
    {
      on: status.ipPinned,
      label: "Outbound calls pinned to the registered IP",
      detail:
        "SEBI requires order placement from a registered static IP. With GROWW_REGISTERED_IP set, every call binds that source address and fails loudly if it cannot.",
    },
  ];
}

const LIMITS = [
  { k: "Order types", v: "MARKET · LIMIT · SL · SL_M" },
  { k: "Products", v: "CNC · MIS · NRML" },
  { k: "Bracket orders", v: "None — Groww offers GTT + OCO instead" },
  { k: "Order rate limit", v: "10/s · 250/min" },
  { k: "Data rate limit", v: "10/s · 300/min" },
  { k: "Streaming", v: "Up to 1,000 instruments" },
];

export default async function BrokerPage() {
  const [account, status] = await Promise.all([getAccount(), getConnectionStatus()]);
  const steps = buildSteps(status);
  // "Connected" means a live call succeeded — not that env vars exist.
  const pill = status.live
    ? { tone: "up" as const, text: "Connected" }
    : status.credentials
      ? { tone: "warn" as const, text: "Credentials set — API call failing" }
      : { tone: "neutral" as const, text: "Not connected" };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Broker" sub="How MNHA Financials connects to your Groww account." />

      <Card className="mb-5">
        <CardHead
          title="Groww"
          sub={account.email}
          right={<Pill tone={pill.tone}>{pill.text}</Pill>}
        />

        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-[12px] text-ink3">Account</dt>
            <dd className="mt-1 text-[14.5px] font-semibold text-ink">{account.name}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Available cash</dt>
            <dd className={`tnum mt-1 text-[14.5px] font-semibold ${account.balance === null ? "text-ink3" : "text-ink"}`}>
              {account.balance === null ? "—" : fmtMoney(account.balance)}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Margin used</dt>
            <dd className={`tnum mt-1 text-[14.5px] font-semibold ${account.usedMargin === null ? "text-ink3" : "text-ink"}`}>
              {account.usedMargin === null ? "—" : fmtMoney(account.usedMargin)}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Client code</dt>
            <dd className={`tnum mt-1 text-[14.5px] font-semibold ${account.ucc === null ? "text-ink3" : "text-ink"}`}>
              {account.ucc ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Segments</dt>
            <dd className="mt-1 text-[14.5px] font-semibold text-ink">
              {account.segments.length ? account.segments.join(" · ") : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-ink3">Session</dt>
            <dd className="mt-1 text-[14.5px] font-semibold text-ink">09:15–15:30</dd>
          </div>
        </dl>

        {!status.live && (
          <div className="mt-5 border-t border-line pt-5">
            <p className="text-[12.5px] leading-relaxed text-ink3">
              Connecting is server configuration, not a button: set GROWW_API_KEY, GROWW_API_SECRET and
              GROWW_TOTP_SECRET in the server environment (see .env.example). Until a live call succeeds,
              account screens stay empty rather than showing a number nobody can stand behind.
            </p>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <CardHead title="Connection checks" sub="Each tick is verified separately, just now" />
        <ul className="space-y-3.5">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-3">
              <Dot on={s.on} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-ink">{s.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink3">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="Groww API limits" sub="What the integration paces itself against" />
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
