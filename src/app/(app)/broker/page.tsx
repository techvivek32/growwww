import type { Metadata } from "next";
import Link from "next/link";
import { getAccount, getConnectionStatus } from "@/lib/api/broker";
import { isOwnerSession } from "@/lib/access";
import { fmtMoney } from "@/lib/format";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Broker · MNHA Financials" };

// Reads the live broker account — never bake this at build time.
export const dynamic = "force-dynamic";

const label = "font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase";

function Dot({ on }: { on: boolean }) {
  return (
    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border ${on ? "border-up/50 bg-upsoft text-up" : "border-line2 text-ink3"}`}>
      {on ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      ) : (
        <span className="h-1.5 w-1.5 bg-ink3" aria-hidden="true" />
      )}
    </span>
  );
}

interface Step {
  on: boolean;
  label: string;
  detail: string;
}

/** Each row's tick reflects a distinct, verifiable fact — not one boolean. */
function ownerSteps(status: { credentials: boolean; live: boolean; ipPinned: boolean }): Step[] {
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

/** The same three facts, about the member's own key. */
function memberSteps(status: { credentials: boolean; live: boolean }): Step[] {
  return [
    {
      on: status.credentials,
      label: "Your Groww key is on file",
      detail: "Stored encrypted, used only for your own account, and never displayed.",
    },
    {
      on: status.live,
      label: "Live read verified",
      detail: status.live
        ? "A TOTP-authenticated read of your Groww account succeeded just now — which also shows your Groww API subscription is active."
        : "Groww did not answer a read of your account just now. If this persists, re-connect from Settings.",
    },
    {
      on: true,
      label: "No static IP needed",
      detail: "A static IP is needed only for placing orders through the API. Your account is view-only, so leave the IP on your Groww key empty — Groww allows one IP on one account only.",
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
  const [account, status, isOwner] = await Promise.all([getAccount(), getConnectionStatus(), isOwnerSession()]);
  const steps = isOwner ? ownerSteps(status) : memberSteps(status);

  // "Connected" means a live call succeeded — not that a key exists.
  const pill = status.live
    ? { tone: "up" as const, text: "Connected" }
    : status.credentials
      ? { tone: "warn" as const, text: isOwner ? "Credentials set — API call failing" : "Key on file — not answering" }
      : { tone: "neutral" as const, text: "Not connected" };

  const facts: { k: string; v: string | null; num?: boolean }[] = [
    { k: "Account", v: account.name },
    { k: "Available cash", v: account.balance === null ? null : fmtMoney(account.balance), num: true },
    { k: "Margin used", v: account.usedMargin === null ? null : fmtMoney(account.usedMargin), num: true },
    { k: "Client code", v: account.ucc, num: true },
    { k: "Segments", v: account.segments.length ? account.segments.join(" · ") : null },
    { k: "Session", v: "09:15–15:30", num: true },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead
        title="Broker"
        sub={
          isOwner
            ? "How MNHA Financials connects to your Groww account."
            : "Your Groww link, read-only. Your money and positions stay with Groww."
        }
      />

      <Card className="mb-5">
        <CardHead title="Groww" sub={account.email} right={<Pill tone={pill.tone}>{pill.text}</Pill>} />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.k} className="min-w-0">
              <dt className={label}>{f.k}</dt>
              <dd className={`mt-1.5 text-[14.5px] font-semibold break-words ${f.num ? "tnum" : ""} ${f.v === null ? "text-ink3" : "text-ink"}`}>
                {f.v ?? "—"}
              </dd>
            </div>
          ))}
        </dl>

        {!status.live && (
          <div className="mt-5 border-t border-line pt-5">
            {isOwner ? (
              <p className="text-[12.5px] leading-relaxed text-ink3">
                Connecting is server configuration, not a button: set GROWW_API_KEY, GROWW_API_SECRET and
                GROWW_TOTP_SECRET in the server environment (see .env.example). Until a live call succeeds,
                account screens stay empty rather than showing a number nobody can stand behind.
              </p>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-ink3">
                We could not read your Groww account just now, so these stay empty rather than showing a number nobody
                can stand behind. Your money is unaffected.{" "}
                <Link href="/settings" className="font-semibold text-brandtext hover:underline">
                  Re-connect from Settings →
                </Link>
              </p>
            )}
          </div>
        )}
      </Card>

      <Card className={isOwner ? "mb-5" : ""}>
        <CardHead title="Connection checks" sub="Each tick is verified separately, just now" />
        <ul className="divide-y divide-line border-t border-line">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-3 py-3.5">
              <Dot on={s.on} />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-ink">{s.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink3">{s.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Order types and rate limits are the house desk's concern; member accounts are view-only. */}
      {isOwner && (
        <Card>
          <CardHead title="Groww API limits" sub="What the integration paces itself against" />
          <dl className="grid gap-x-6 sm:grid-cols-2">
            {LIMITS.map((c) => (
              <div key={c.k} className="border-t border-line py-3">
                <dt className={label}>{c.k}</dt>
                <dd className="mt-1 text-[13.5px] font-medium text-ink">{c.v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}
