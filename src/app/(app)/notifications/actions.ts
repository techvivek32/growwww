"use server";

import { revalidatePath } from "next/cache";
import { currentUserId, inAdminView } from "@/lib/session";
import { markAllRead } from "@/lib/notifications";

export async function markAllReadAction(): Promise<void> {
  const uid = await currentUserId();
  // The client's unread marks are how they notice what the admin did in their
  // account, so the admin cannot clear them.
  if (uid && !(await inAdminView())) await markAllRead(uid);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
