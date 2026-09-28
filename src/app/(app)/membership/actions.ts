"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getNav } from "@/lib/api/broker";
import { enroll, leave } from "@/lib/membership";
import { notify } from "@/lib/notifications";

export interface MemberState {
  error?: string;
}

export async function enrollAction(_prev: MemberState, _form: FormData): Promise<MemberState> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return { error: "Sign in as a user account first." };

  const nav = await getNav();
  if (!nav || nav.nav <= 0) return { error: "Could not read your account value. Connect your broker and try again." };

  await enroll(uid, nav.nav);
  await notify(uid, {
    kind: "account",
    tone: "up",
    title: "Membership started",
    body: `Your performance period has begun at ₹${Math.round(nav.nav).toLocaleString("en-IN")}. A fee applies only to profit above this level — losses are your own.`,
    key: `member-${Date.now()}`,
  });
  revalidatePath("/membership");
  return {};
}

export async function leaveAction(): Promise<void> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return;
  await leave(uid);
  revalidatePath("/membership");
}
