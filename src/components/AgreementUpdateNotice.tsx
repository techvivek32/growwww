import Link from "next/link";
import { AGREEMENT_VERSION, INVITE_TO_SIGN, currentConsent } from "@/lib/consent";

/**
 * For a member whose signed agreement is an earlier version that is still
 * accepted: one line saying a newer version exists, with the way to review and
 * sign it. Nothing is blocked; for them, signing the new version is optional.
 */
export default async function AgreementUpdateNotice({ userId }: { userId: string }) {
  const signed = await currentConsent(userId);
  // Signers of an earlier version that still counts: none of those texts describes the automatic strategy.
  if (!signed || !INVITE_TO_SIGN.includes(signed.agreementVersion)) return null;
  const version = AGREEMENT_VERSION.split(" ")[0];
  return (
    <div className="border-b border-line bg-surface">
      <p className="mx-auto max-w-[1360px] px-4 py-2 text-[12.5px] leading-snug text-ink2 lg:px-6">
        We have updated our user agreement to version {version}. It now describes MNHA&apos;s automatic intraday
        strategy, which trades connected accounts, and the orders and exits MNHA&apos;s admin can send.{" "}
        <Link href="/consent" className="font-semibold text-ink underline underline-offset-2">
          Review and sign it
        </Link>{" "}
        — your access stays the same either way.
      </p>
    </div>
  );
}
