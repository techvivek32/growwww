import "server-only";
import { getConnectionStatus } from "@/lib/api/broker";
import NotConnected from "@/components/NotConnected";

/**
 * The empty state for a portfolio screen, told honestly.
 *
 * An empty list means three different things, and only one of them is "you
 * have none": the account answered with nothing; the account is linked but did
 * not answer (so the truth is unknown); or no account is linked at all. The
 * status check runs in this viewer's own credential context — the synchronous
 * `isConnected()` does not, and would describe the house account instead.
 */
export default async function AccountEmpty({
  noun,
  empty,
}: {
  /** Plural, lower-case, read in a sentence: "holdings", "open positions", "orders"… */
  noun: string;
  /** Copy for an account that answered and genuinely has none. */
  empty: { what: string; detail: string };
}) {
  const status = await getConnectionStatus();

  if (status.live) return <NotConnected connected what={empty.what} detail={empty.detail} />;

  if (status.credentials) {
    return (
      <NotConnected
        what="Groww did not answer"
        detail={`Your Groww account is linked, but it did not respond just now — so this page cannot tell whether there are any ${noun}. An expired or revoked API key is the usual cause.`}
      />
    );
  }

  return (
    <NotConnected
      what="Groww account not connected"
      detail={`Your ${noun} are read live from your Groww account, so there is nothing to show until it is connected.`}
    />
  );
}
