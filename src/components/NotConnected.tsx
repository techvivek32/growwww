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
}: {
  what: string;
  detail: string;
}) {
  return (
    <Card pad={false}>
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-surface2 text-ink3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
          </svg>
        </span>

        <p className="mt-4 text-[16px] font-semibold text-ink">{what}</p>
        <p className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink3">{detail}</p>

        <Link
          href="/broker"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand px-5 text-[14px] font-semibold text-white transition-colors hover:bg-brandh"
        >
          Connect Groww account
        </Link>
      </div>
    </Card>
  );
}
