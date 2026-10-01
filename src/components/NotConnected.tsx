import Link from "next/link";
import { Card } from "./ui";

/**
 * Shown on every account-dependent screen while no broker is connected.
 *
 * It names what is missing rather than showing a zero, because a zero balance
 * and an absent balance are different facts and only one of them is true.
 */
export default function NotConnected({
  what,
  detail,
  connected = false,
}: {
  what: string;
  detail: string;
  /** A connected account with nothing to show is empty, not disconnected. */
  connected?: boolean;
}) {
  return (
    <Card pad={false}>
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full border border-line2 text-ink3" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
          </svg>
        </span>

        <p className="pub-display mt-4 text-[26px] leading-tight text-ink">{what}</p>
        <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink3">{detail}</p>

        {!connected && (
          <Link
            href="/broker"
            className="mt-6 inline-flex h-10 items-center border border-line2 px-4 text-[13.5px] font-semibold text-ink transition-colors hover:bg-surfaceh"
          >
            How connecting works
          </Link>
        )}
      </div>
    </Card>
  );
}
