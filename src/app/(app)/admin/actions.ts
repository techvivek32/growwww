"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { clearBroker, deleteUser } from "@/lib/users";

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
  if (userId && userId !== OWNER_ID) await deleteUser(userId);
  revalidatePath("/admin");
}
