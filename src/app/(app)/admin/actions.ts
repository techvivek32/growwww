"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { clearBroker, deleteUser } from "@/lib/users";
import { setKycDecision, scheduleKycCall, deleteKyc } from "@/lib/kyc";
import { deleteConsents } from "@/lib/consent";
import { deleteConsentMedia } from "@/lib/consentMedia";
import { notify } from "@/lib/notifications";

/** Every admin action re-checks the caller is the owner — never trust the UI. */
async function requireOwner(): Promise<boolean> {
  return (await currentUserId()) === OWNER_ID;
}

export async function adminDisconnectBroker(formData: FormData): Promise<void> {
  if (!(await requireOwner())) return;
  const userId = String(formData.get("userId") ?? "");
  if (userId && userId !== OWNER_ID) await clearBroker(userId);
  revalidatePath("/admin");
}

export async function adminDeleteUser(formData: FormData): Promise<void> {
  if (!(await requireOwner())) return;
  const userId = String(formData.get("userId") ?? "");
  if (userId && userId !== OWNER_ID) {
    await deleteUser(userId);
    await deleteKyc(userId); // erase their KYC record + uploaded files too
    await deleteConsents(userId);
    await deleteConsentMedia(userId);
  }
  revalidatePath("/admin");
}

export async function adminKycDecision(formData: FormData): Promise<void> {
  if (!(await requireOwner())) return;
  const userId = String(formData.get("userId") ?? "");
  const decision = String(formData.get("decision") ?? "") === "approved" ? "approved" : "rejected";
  const notes = String(formData.get("notes") ?? "");
  if (!userId) return;
  await setKycDecision(userId, decision, notes);
  await notify(userId, {
    kind: "account",
    tone: decision === "approved" ? "up" : "down",
    title: decision === "approved" ? "Identity verified" : "Verification not approved",
    body: decision === "approved" ? "Your identity is confirmed. Thanks for verifying." : (notes || "Please review your details and submit again."),
  });
  revalidatePath("/admin");
}

export async function adminScheduleKycCall(formData: FormData): Promise<void> {
  if (!(await requireOwner())) return;
  const userId = String(formData.get("userId") ?? "");
  const at = String(formData.get("callAt") ?? "").trim();
  const link = String(formData.get("callLink") ?? "").trim();
  if (!userId) return;
  const ms = at ? new Date(at).getTime() : NaN;
  await scheduleKycCall(userId, Number.isFinite(ms) ? ms : null, link || null);
  await notify(userId, {
    kind: "account",
    tone: "neutral",
    title: "Verification call scheduled",
    body: "Your identity-verification video call has been scheduled. See the details on your verification page.",
  });
  revalidatePath("/admin");
}
