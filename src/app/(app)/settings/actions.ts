"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUserId, clearSession } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { changePassword, clearBroker, deleteUser } from "@/lib/users";

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
  await deleteUser(uid);
  await clearSession();
  redirect("/");
}
