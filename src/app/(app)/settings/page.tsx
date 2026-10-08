import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHead, Pill } from "@/components/ui";
import Link from "next/link";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { findById, hasBroker } from "@/lib/users";
import { getKycView } from "@/lib/kyc";
import { getConnectionStatus } from "@/lib/api/broker";
import { logout } from "@/app/login/actions";
import ThemeToggle from "@/components/ThemeToggle";
import ChangePassword from "./ChangePassword";
import { disconnectBrokerAction, deleteAccountAction, setOptionalConsentAction } from "./actions";
import { currentConsent, CONTRACT, AGREEMENT_VERSION, OPTIONAL_CONSENTS } from "@/lib/consent";

export const metadata: Metadata = { title: "Settings · MNHA Financials" };
export const dynamic = "force-dynamic";

const btnLine =
  "inline-flex h-10 items-center border border-line2 px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-surfaceh";
const btnSolid =
  "inline-flex h-10 items-center bg-brand px-4 text-[13.5px] font-semibold text-onbrand transition-colors hover:bg-brandh";
const body = "text-[14px] leading-relaxed text-ink2";

/** One ledger row: a numbered serif title on the left, the setting on the right. */
function Section({
  n,
  title,
  sub,
  badge,
  children,
}: {
  n: string;
  title: string;
  sub?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 py-8 first:pt-0 sm:grid-cols-[13rem_1fr] sm:gap-10">
      <div className="min-w-0">
        <p className="font-mono text-[11px] text-ink3">{n}</p>
        <h2 className="pub-display mt-1 text-[26px] leading-tight text-ink">{title}</h2>
        {sub && <p className="mt-1.5 text-[13px] leading-snug break-words text-ink3">{sub}</p>}
        {badge && <div className="mt-3">{badge}</div>}
      </div>
      <div className="min-w-0 sm:pt-5">{children}</div>
    </section>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ delete?: string; failed?: string }> }) {
  const uid = await currentUserId();
  const isOwner = uid === OWNER_ID;
  const [user, keyOnFile, kyc, status] = await Promise.all([
    uid && !isOwner ? findById(uid) : null,
    uid && !isOwner ? hasBroker(uid) : true,
    uid && !isOwner ? getKycView(uid) : { status: "none" as const },
    getConnectionStatus(),
  ]);
  const consent = uid && !isOwner ? await currentConsent(uid) : null;
  const consentDate = consent
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(consent.consentedAt)
    : null;
  const { delete: deleteFlag, failed: failedParts } = await searchParams;

  // "Live" only when a call to Groww actually answered just now — a stored key alone is not a live link.
  const link = !keyOnFile
    ? { tone: "neutral" as const, text: "Not connected" }
    : status.live
      ? { tone: "up" as const, text: "Live" }
      : { tone: "warn" as const, text: "Not answering" };

  const kycBadge =
    kyc.status === "approved" ? <Pill tone="up">Verified</Pill> :
    kyc.status === "rejected" ? <Pill tone="down">Rejected</Pill> :
    kyc.status === "submitted" ? <Pill tone="warn">In review</Pill> :
    <Pill tone="neutral">Not started</Pill>;

  // Section numbers: the owner has Linked accounts first; members have Identity and Delete.
  const o = isOwner ? 1 : 0;
  // Owner: linked, account, broker, then appearance; members: account, broker, identity, privacy, then appearance.
  const tail = isOwner ? 4 : 5;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHead title="Settings" sub="Your account, your Groww link, your data." />

      <div className="divide-y divide-line">
        {/* Linked accounts (owner's demo workspace) */}
        {isOwner && (
          <Section n="01" title="Linked accounts" sub="A multi-account view of trades and P&L">
            <p className={`mb-5 ${body}`}>
              Open the linked-accounts view to see every account you manage in one place, with their recent trades and
              P&amp;L side by side.
            </p>
            <Link href="/linked-accounts" className={btnLine}>
              Open linked accounts
            </Link>
          </Section>
        )}

        {/* Account */}
        <Section n={`0${1 + o}`} title="Account" sub={isOwner ? "House account" : user?.email}>
          {isOwner ? (
            <p className={body}>
              You are signed in as the house account. Its credentials live in the server environment and are not managed
              here.
            </p>
          ) : (
            <>
              <p className="mb-4 font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Change your password</p>
              <ChangePassword />
            </>
          )}
        </Section>

        {/* Broker */}
        <Section
          n={`0${2 + o}`}
          title="Groww link"
          sub={isOwner ? "Server credentials" : keyOnFile ? "Your key is on file, encrypted" : "No broker connected"}
          badge={<Pill tone={link.tone}>{link.text}</Pill>}
        >
          {isOwner ? (
            <p className={body}>
              The house account uses the server&apos;s Groww API credentials.
              {!status.live && " The last call to Groww did not answer — see Broker for each check."}
            </p>
          ) : (
            <>
              <p className={body}>
                Your Groww API key is stored encrypted and used only to read your own account. Disconnecting removes the
                stored credentials; you can reconnect any time.
                {keyOnFile && !status.live && " Groww did not answer just now — if that keeps happening, re-connect."}
              </p>

              <dl className="mt-5 border-y border-line">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <dt className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">Static IP</dt>
                  <dd className="text-[14px] text-ink">Not needed</dd>
                </div>
              </dl>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink3">This address is reserved for your account and is the one registered on your Groww key. The exchange requires every order to arrive from it, so your orders are always sent from here. One address serves one Groww account, so it is never shared.</p>

              <div className="mt-5 flex flex-wrap gap-2">
                {keyOnFile && (
                  <Link href="/connect-broker?reconnect=1" className={btnSolid}>
                    Re-connect Groww
                  </Link>
                )}
                <form action={disconnectBrokerAction}>
                  <button type="submit" className={btnLine}>
                    {keyOnFile ? "Disconnect broker" : "Connect a broker"}
                  </button>
                </form>
              </div>
            </>
          )}
        </Section>

        {/* Identity verification — users only */}
        {!isOwner && (
          <Section n="03" title="Identity" sub="MNHA's own check — not a government KYC" badge={kycBadge}>
            <p className={`mb-5 ${body}`}>
              A form, a selfie and a short live call. Your PAN and date of birth are stored encrypted; your selfie and
              documents open only to you and the reviewer. Everything is deleted if you delete your account.
            </p>
            <Link href="/kyc" className={btnLine}>
              {kyc.status === "none" ? "Start verification" : "View verification"}
            </Link>
          </Section>
        )}

        {/* Privacy & consents — users only */}
        {!isOwner && (
          <Section n="04" title="Privacy & consents" sub={`Agreement version ${AGREEMENT_VERSION}`}>
            {consent ? (
              <>
                <p className={`mb-4 ${body}`}>
                  You signed on {consentDate} IST, in {consent.language === "hi" ? "हिन्दी" : consent.language === "gu" ? "ગુજરાતી" : "English"}.
                  Optional consents can be switched off or on here at any time; that never affects the core service.
                </p>
                <ul className="border-t border-line">
                  {OPTIONAL_CONSENTS.map((key) => {
                    const on = Boolean((consent.current ?? consent.consents)?.[key]);
                    const label = CONTRACT.en.consents.find((k) => k.key === key)?.label ?? key;
                    return (
                      <li key={key} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
                        <span className="text-[14px] text-ink">
                          {label} <span className="font-mono text-[10.5px] tracking-[0.06em] text-ink3 uppercase">· optional · {on ? "on" : "off"}</span>
                        </span>
                        <form action={setOptionalConsentAction}>
                          <input type="hidden" name="key" value={key} />
                          <input type="hidden" name="value" value={on ? "" : "on"} />
                          <button type="submit" className={btnLine}>
                            {on ? "Withdraw" : "Give consent"}
                          </button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-[13px] leading-relaxed text-ink3">
                  Disconnecting Groww (above) withdraws the read-only Groww consent and is recorded here; deleting your
                  account (below) withdraws all of them. Questions or data requests: support@mnhafinancials.com.
                </p>
              </>
            ) : (
              <p className={body}>No signed agreement on record for this version.</p>
            )}
          </Section>
        )}

        {/* Appearance */}
        <Section n={`0${tail}`} title="Appearance" sub="Remembered in this browser only">
          <div className="flex items-center gap-4">
            <span className="border border-line">
              <ThemeToggle />
            </span>
            <p className={body}>Light paper or dark ink. The choice never leaves your device.</p>
          </div>
        </Section>

        {/* Session */}
        <Section n={`0${tail + 1}`} title="Session" sub="Sessions last eight hours">
          <form action={logout}>
            <button type="submit" className={btnLine}>
              Sign out
            </button>
          </form>
        </Section>

        {/* Danger zone — users only */}
        {!isOwner && (
          <Section n="07" title="Delete account" sub="Permanent — removes your account and stored broker credentials">
            <p className={`mb-5 ${body}`}>
              This cannot be undone. Your positions and money are with Groww and are not affected — only your MNHA account
              and its stored data are removed. Membership invoices are kept as billing records.
            </p>
            {deleteFlag === "partial" && (
              <p role="alert" className="mb-4 border-l-2 border-down bg-downsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                Some of your data could not be erased{failedParts ? ` (${failedParts.replace(/[^a-z ,]/gi, "").slice(0, 120)})` : ""}. Nothing
                was hidden from you — please try again, or contact support and we will finish the erasure.
              </p>
            )}
            {deleteFlag === "active" && (
              <p role="alert" className="mb-4 border-l-2 border-warn bg-warnsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                Your membership is still running. Leave it first from Membership — that closes the current period — and
                then delete your account.
              </p>
            )}
            {deleteFlag === "due" && (
              <p role="alert" className="mb-4 border-l-2 border-warn bg-warnsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
                You have an unpaid membership invoice. Please settle it first — see Membership — and then delete your account.
              </p>
            )}
            <form action={deleteAccountAction}>
              <button type="submit" className="inline-flex h-10 items-center bg-down px-4 text-[13.5px] font-semibold text-onbrand transition-opacity hover:opacity-90">
                Delete my account
              </button>
            </form>
          </Section>
        )}
      </div>
    </div>
  );
}
