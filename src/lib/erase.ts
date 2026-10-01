import "server-only";
import { deleteUser } from "@/lib/users";
import { deleteKyc } from "@/lib/kyc";
import { deleteConsents } from "@/lib/consent";
import { deleteConsentMedia } from "@/lib/consentMedia";
import { deleteMembership } from "@/lib/membership";
import { deleteOrders } from "@/lib/ledger";
import { deleteNotifications } from "@/lib/notifications";

/**
 * Erase one account everywhere. Each store is attempted even if another fails
 * (a corrupt file must not leave an account half-erased and undeletable); the
 * user record goes last, and the stores that could not be erased are returned
 * so the caller can surface them. Invoices are kept — see deleteMembership.
 */
export async function eraseAccount(userId: string): Promise<string[]> {
  const steps: [string, (id: string) => Promise<void>][] = [
    ["verification", deleteKyc],
    ["agreement", deleteConsents],
    ["agreement media", deleteConsentMedia],
    ["membership", deleteMembership],
    ["order log", deleteOrders],
    ["notifications", deleteNotifications],
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
  return failed;
}
