"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/session";
import { markAllRead } from "@/lib/notifications";

export async function markAllReadAction(): Promise<void> {
  const uid = await currentUserId();
  if (uid) await markAllRead(uid);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
