import { getAccount, getConnectionStatus, getNav, canTrade, isConnected } from "@/lib/api/broker";
import { getMembership, listInvoices, hasDueInvoice } from "@/lib/membership";
import { getKycView } from "@/lib/kyc";
import { hasConsented, currentConsent, AGREEMENT_VERSION, INVITE_TO_SIGN } from "@/lib/consent";
import { unreadCount } from "@/lib/notifications";
import { marketState } from "@/lib/market";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/account — everything the web splits across /settings,
 * /membership and /broker, in one read.
 *
 * Three pages on a desktop with a nav rail; one scrollable screen on a phone.
 * Fetching it as one request rather than three also means the app never shows
 * a half-built account screen where the broker panel has arrived and the
 * membership panel has not.
 *
 * KYC and consent are reported as *status only*. Neither can be completed in
 * the app — both capture camera video and documents and stay on the web so
 * there is a single record of what was signed — but hiding their state would
 * leave a member unable to see why their account is limited.
 */
export async function GET() {
  return guarded(async (c) => {
    const [account, connection, nav, membership, invoices, due, kyc, consented, signed, unread] =
      await Promise.all([
        getAccount(),
        getConnectionStatus(),
        getNav(),
        getMembership(c.userId),
        listInvoices(c.userId),
        hasDueInvoice(c.userId),
        getKycView(c.userId),
        hasConsented(c.userId),
        currentConsent(c.userId),
        unreadCount(c.userId),
      ]);

    return json({
      userId: c.userId,
      role: c.role,
      account,
      broker: {
        ...connection,
        connected: isConnected(),
        // Separate from `connected` on purpose: a connected but read-only
        // account still shows balances, and an enabled Buy control against it
        // would be a lie discovered at the worst moment.
        canTrade: canTrade(),
      },
      nav,
      membership,
      invoices,
      hasDueInvoice: due,
      kyc,
      consented,
      // The signed agreement version, and whether a NEWER one is on offer.
      // Mirrors AgreementUpdateNotice on the web: an older-but-still-accepted
      // signature is not blocked, so this is an invitation, never a gate —
      // the app must not present it as one.
      agreement: {
        current: AGREEMENT_VERSION,
        signedVersion: signed?.agreementVersion ?? null,
        updateOffered: signed ? INVITE_TO_SIGN.includes(signed.agreementVersion) : false,
      },
      // The two consents a member may switch off at will, as they stand NOW —
      // `current` once changed, otherwise as signed. Without these the app
      // could offer the switches but never show which way they are set, and a
      // consent control that cannot report its own state is worse than none.
      optionalConsents: {
        marketing: (signed?.current ?? signed?.consents)?.marketing ?? false,
        analytics: (signed?.current ?? signed?.consents)?.analytics ?? false,
      },
      unread,
      market: marketState(),
    });
  });
}
