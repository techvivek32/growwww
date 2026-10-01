"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUserId, clearSession } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { changePassword, clearBroker } from "@/lib/users";
import { getMembership, hasDueInvoice } from "@/lib/membership";
import { eraseAccount } from "@/lib/erase";

export interface PwState {
  error?: string;
  ok?: boolean;
}

export async function changePasswordAction(_prev: PwState, formData: FormData): Promise<PwState> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return { error: "The house account password is managed in the server environment." };

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
  if (!uid || uid === OWNER_ID) return;
  await clearBroker(uid);
  revalidatePath("/settings");
  redirect("/connect-broker");
}

export async function deleteAccountAction(): Promise<void> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return;
  // A running membership period must be closed first (Leave does that at a
  // live reading), and an unpaid invoice settled — deletion skips neither.
  if ((await getMembership(uid))?.status === "active") redirect("/settings?delete=active");
  if (await hasDueInvoice(uid)) redirect("/settings?delete=due");
  const failed = await eraseAccount(uid);
  if (failed.length) {
    console.error(`[erase] account ${uid} partly erased; failed: ${failed.join(", ")}`);
    // Never pretend: keep the session and say what could not be erased.
    redirect(`/settings?delete=partial&failed=${encodeURIComponent(failed.join(","))}`);
  }
  await clearSession();
  redirect("/");
}
