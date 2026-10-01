import type { Metadata } from "next";
import { PageHead, Card, CardHead } from "@/components/ui";
import Link from "next/link";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { findById, hasBroker } from "@/lib/users";
import { getKycView } from "@/lib/kyc";
import { registeredIp } from "@/lib/api/groww";
import { logout } from "@/app/login/actions";
import ChangePassword from "./ChangePassword";
import { disconnectBrokerAction, deleteAccountAction } from "./actions";

export const metadata: Metadata = { title: "Settings · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ delete?: string; failed?: string }> }) {
  const uid = await currentUserId();
  const isOwner = uid === OWNER_ID;
  const user = uid && !isOwner ? await findById(uid) : null;
  const connected = uid && !isOwner ? await hasBroker(uid) : true;
  const kyc = uid && !isOwner ? await getKycView(uid) : { status: "none" as const };
  const serverIp = registeredIp();
  // Confirmed only if the user ticked it for THIS server address.
  const confirmedIp = user?.broker?.ipConfirmedAt ? (user.broker.staticIp ?? null) : null;
  const ipConfirmed = confirmedIp !== null && confirmedIp === serverIp;
  const { delete: deleteFlag, failed: failedParts } = await searchParams;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Settings" sub="Your account, your broker connection, your data." />

      {/* Linked accounts */}
      <Card className="mb-5">
        <CardHead
          title="Linked accounts"
          sub="A multi-account view of trades and P&L"
        />
        <p className="mb-4 text-[13.5px] leading-relaxed text-ink2">
          Open the linked-accounts view to see every account you manage in one place, with their recent trades and
          P&amp;L side by side.
        </p>
        <Link href="/linked-accounts" className="inline-flex h-10 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink hover:bg-surfaceh">
          Open linked accounts
        </Link>
      </Card>

      {/* Account */}
      <Card className="mb-5">
        <CardHead title="Account" sub={isOwner ? "House account (managed in the server environment)" : user?.email} />
        {isOwner ? (
          <p className="text-[13.5px] leading-relaxed text-ink2">
            You are signed in as the house account. Its credentials live in the server environment and are not managed
            here.
          </p>
        ) : (
          <>
            <p className="mb-4 text-[13px] text-ink3">Change your password</p>
            <ChangePassword />
          </>
        )}
      </Card>

      {/* Broker */}
      <Card className="mb-5">
        <CardHead
          title="Broker connection"
          sub={connected ? "Connected to Groww" : "No broker connected"}
          right={
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${connected ? "bg-upsoft text-up" : "bg-warnsoft text-warn"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-up" : "bg-warn"}`} />
              {connected ? "Live" : "Not connected"}
            </span>
          }
        />
        {isOwner ? (
          <p className="text-[13.5px] leading-relaxed text-ink2">The house account uses the server&apos;s Groww API credentials.</p>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-ink2">
              Your Groww API key is stored encrypted and used only for your account. Disconnecting removes the stored
              credentials; you can reconnect any time.
            </p>
            <div className="mt-4 rounded-lg border border-line bg-surface2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink2">
              <p>
                Static IP to register on your Groww key:{" "}
                <span className="tnum font-mono font-semibold text-ink">{serverIp ?? "—"}</span>
                {connected && serverIp && (
                  <span className={ipConfirmed ? "text-up" : "text-warn"}>
                    {" "}· {ipConfirmed
                      ? "you confirmed adding it"
                      : confirmedIp
                        ? `you confirmed ${confirmedIp}; the server now uses this address — update it on Groww`
                        : "not confirmed — Groww rejects orders until it is on your key"}
                  </span>
                )}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {connected && (
                <Link href="/connect-broker?reconnect=1" className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white hover:bg-brandh">
                  Re-connect Groww
                </Link>
              )}
              <form action={disconnectBrokerAction}>
                <button type="submit" className="inline-flex h-10 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink hover:bg-surfaceh">
                  {connected ? "Disconnect broker" : "Connect a broker"}
                </button>
              </form>
            </div>
          </>
        )}
      </Card>

      {/* Identity verification — users only */}
      {!isOwner && (
        <Card className="mb-5">
          <CardHead
            title="Identity verification"
            sub="MNHA's own check (form + selfie + live call) — not a government KYC"
            right={
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                kyc.status === "approved" ? "bg-upsoft text-up" : kyc.status === "rejected" ? "bg-downsoft text-down" : kyc.status === "submitted" ? "bg-warnsoft text-warn" : "bg-surface2 text-ink2"
              }`}>
                {kyc.status === "approved" ? "Verified" : kyc.status === "rejected" ? "Rejected" : kyc.status === "submitted" ? "In review" : "Not started"}
              </span>
            }
          />
          <p className="mb-4 text-[13.5px] leading-relaxed text-ink2">
            Your PAN and date of birth are stored encrypted; your selfie and documents open only to you and the
            reviewer. Everything is deleted if you delete your account.
          </p>
          <Link href="/kyc" className="inline-flex h-10 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink hover:bg-surfaceh">
            {kyc.status === "none" ? "Start verification" : "View verification"}
          </Link>
        </Card>
      )}

      {/* Appearance */}
      <Card className="mb-5">
        <CardHead title="Appearance" sub="Light by default; your choice is remembered in this browser only" />
        <p className="text-[13.5px] leading-relaxed text-ink2">
          Use the sun / moon control in the top bar to switch between light and dark. The preference never leaves your
          device.
        </p>
      </Card>

      {/* Session */}
      <Card className="mb-5">
        <CardHead title="Session" sub="Sessions last eight hours" />
        <form action={logout}>
          <button type="submit" className="inline-flex h-10 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink hover:bg-surfaceh">
            Sign out
          </button>
        </form>
      </Card>

      {/* Danger zone — users only */}
      {!isOwner && (
        <Card className="border-down/40">
          <CardHead title="Delete account" sub="Permanent — removes your account and stored broker credentials" />
          <p className="mb-4 text-[13.5px] leading-relaxed text-ink2">
            This cannot be undone. Your positions and money are with Groww and are not affected — only your MNHA account
            and its stored data are removed. Membership invoices are kept as billing records.
          </p>
          {deleteFlag === "partial" && (
            <p role="alert" className="mb-4 rounded-lg border border-down/40 bg-downsoft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
              Some of your data could not be erased{failedParts ? ` (${failedParts.replace(/[^a-z ,]/gi, "").slice(0, 120)})` : ""}. Nothing
              was hidden from you — please try again, or contact support and we will finish the erasure.
            </p>
          )}
          {deleteFlag === "active" && (
            <p role="alert" className="mb-4 rounded-lg border border-warn/40 bg-warnsoft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
              Your membership is still running. Leave it first from Membership — that closes the current period — and
              then delete your account.
            </p>
          )}
          {deleteFlag === "due" && (
            <p role="alert" className="mb-4 rounded-lg border border-warn/40 bg-warnsoft px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">
              You have an unpaid membership invoice. Please settle it first — see Membership — and then delete your account.
            </p>
          )}
          <form action={deleteAccountAction}>
            <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-down px-4 text-[13.5px] font-semibold text-white hover:opacity-90">
              Delete my account
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}
