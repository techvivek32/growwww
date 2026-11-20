"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUserId, clearSession, ADMIN_VIEW_REFUSAL, inAdminView } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { changePassword, clearBroker } from "@/lib/users";
import { getMembership, hasDueInvoice } from "@/lib/membership";
import { eraseAccount } from "@/lib/erase";
import { liveExposure } from "@/lib/liveTrading/orders";
import { withAccountLock } from "@/lib/liveTrading/util";
import { clearErasing, markErasing } from "@/lib/kycHandoff";
import { setOptionalConsent, recordConsentChange, OPTIONAL_CONSENTS, type ConsentKey } from "@/lib/consent";

export interface PwState {
  error?: string;
  ok?: boolean;
}

export async function changePasswordAction(_prev: PwState, formData: FormData): Promise<PwState> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return { error: "This account's password is managed in the server environment." };
  if (await inAdminView()) return { error: ADMIN_VIEW_REFUSAL };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (next !== confirm) return { error: "The two new passwords do not match." };

  const res = await changePassword(uid, current, next);
  if (!res.ok) return { error: res.error };
  return { ok: true };
}

export async function disconnectBrokerAction(): Promise<void> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid) || (await inAdminView())) return; // admin: use Disconnect in the console
  await clearBroker(uid);
  await recordConsentChange(uid, "groww", false); // the withdrawal is part of the consent record
  revalidatePath("/settings");
  redirect("/connect-broker");
}

export async function deleteAccountAction(): Promise<void> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid) || (await inAdminView())) return; // admin: use Delete in the console
  // A running membership period must be closed first (Leave does that at a
  // live reading), and an unpaid invoice settled — deletion skips neither.
  if ((await getMembership(uid))?.status === "active") redirect("/settings?delete=active");
  if (await hasDueInvoice(uid)) redirect("/settings?delete=due");
  // Not while MNHA has something live in the account today: nobody would watch it after. Sends to
  // the account stop first (erasing marked) and the check runs under its lock, so no strategy order
  // can start between the check and the erasure.
  markErasing(uid);
  let exposure: Awaited<ReturnType<typeof liveExposure>>;
  try {
    exposure = await withAccountLock(uid, () => liveExposure(uid));
  } catch (err) {
    clearErasing(uid); // sends must not stay stopped for an account that is not being deleted
    throw err;
  }
  if (exposure) {
    clearErasing(uid);
    redirect(`/settings?delete=${exposure === "open" ? "live" : "unconfirmed"}`);
  }
  const failed = await eraseAccount(uid);
  if (failed.length) {
    console.error(`[erase] account ${uid} partly erased; failed: ${failed.join(", ")}`);
    // Never pretend: say what could not be erased. Once the account record
    // itself is gone this sign-in no longer works, so the word goes to /login.
    if (!failed.includes("account")) {
      await clearSession();
      redirect("/login?erased=partial");
    }
    redirect(`/settings?delete=partial&failed=${encodeURIComponent(failed.join(","))}`);
  }
  await clearSession();
  redirect("/");
}

/** Switch an optional consent (marketing / analytics) on or off — as easy as giving it. */
export async function setOptionalConsentAction(formData: FormData): Promise<void> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid) || (await inAdminView())) return; // a consent is only ever the client's own
  const key = String(formData.get("key") ?? "") as ConsentKey;
  if (!OPTIONAL_CONSENTS.includes(key)) return;
  await setOptionalConsent(uid, key, formData.get("value") === "on");
  revalidatePath("/settings");
}
