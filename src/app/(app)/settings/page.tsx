import type { Metadata } from "next";
import { PageHead, Card, CardHead } from "@/components/ui";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { findById, hasBroker } from "@/lib/users";
import { logout } from "@/app/login/actions";
import ChangePassword from "./ChangePassword";
import { disconnectBrokerAction, deleteAccountAction } from "./actions";

export const metadata: Metadata = { title: "Settings · MNHA Financials" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const uid = await currentUserId();
  const isOwner = uid === OWNER_ID;
  const user = uid && !isOwner ? await findById(uid) : null;
  const connected = uid && !isOwner ? await hasBroker(uid) : true;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHead title="Settings" sub="Your account, your broker connection, your data." />

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
            <form action={disconnectBrokerAction} className="mt-4">
              <button type="submit" className="inline-flex h-10 items-center rounded-lg border border-line2 px-4 text-[13.5px] font-semibold text-ink hover:bg-surfaceh">
                {connected ? "Disconnect / reconnect broker" : "Connect a broker"}
              </button>
            </form>
          </>
        )}
      </Card>

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
            and its stored data are removed.
          </p>
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
