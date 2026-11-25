import "server-only";
import { deleteUser } from "@/lib/users";
import { deleteKyc } from "@/lib/kyc";
import { deleteConsents } from "@/lib/consent";
import { deleteConsentMedia } from "@/lib/consentMedia";
import { deleteMembership } from "@/lib/membership";
import { deleteOrders } from "@/lib/ledger";
import { deleteNotifications } from "@/lib/notifications";
import { deleteDevices } from "@/lib/push/devices";
import { scrubAdminAccessDetails } from "@/lib/adminAccess";
import { forgetAccount } from "@/lib/liveTrading/store";
import { withAccountLock } from "@/lib/liveTrading/util";
import { clearErasing, markErasing, revokeHandoffs } from "@/lib/kycHandoff";

/**
 * Erase one account everywhere. Each store is attempted even if another fails
 * (a corrupt file must not leave an account half-erased and undeletable); the
 * user record goes last, and the stores that could not be erased are returned
 * so the caller can surface them. Invoices are kept — see deleteMembership.
 */
export async function eraseAccount(userId: string): Promise<string[]> {
  let mark: symbol | null = null;
  const steps: [string, (id: string) => Promise<void>][] = [
    // First, so no phone link can upload photos while the rest is erased.
    ["phone links", async (id) => {
      mark = markErasing(id); // uploads already under way, and live-trading sends, write nothing from here on
      revokeHandoffs(id);
    }],
    // Early, and under the account's live-trading lock: no order for it is in flight while it goes.
    ["live trading", (id) => withAccountLock(id, () => forgetAccount(id))],
    ["verification", deleteKyc],
    ["agreement", deleteConsents],
    ["agreement media", deleteConsentMedia],
    ["membership", deleteMembership],
    ["order log", deleteOrders],
    // Before the notifications themselves: an erased account must stop being
    // pushed to on a phone it never signed out of, and a device left
    // registered would keep receiving anything emitted during the erasure.
    ["push devices", deleteDevices],
    ["notifications", deleteNotifications],
    ["admin log details", scrubAdminAccessDetails],
    ["account", deleteUser],
  ];
  const failed: string[] = [];
  for (const [name, fn] of steps) {
    try {
      await fn(userId);
    } catch (e) {
      failed.push(name);
      console.error(`[erase] ${name} failed for ${userId}:`, e instanceof Error ? e.message : e);
    }
  }
  if (failed.includes("account") && mark) clearErasing(userId, mark); // the account is still there: it may upload again
  return failed;
}
