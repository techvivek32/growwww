"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { getNavStrict } from "@/lib/api/broker";
import { getBroker } from "@/lib/users";
import { enroll, leave, settlementNotice } from "@/lib/membership";
import { notify } from "@/lib/notifications";

export interface MemberState {
  error?: string;
}

export async function enrollAction(_prev: MemberState, _form: FormData): Promise<MemberState> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return { error: "Sign in as a user account first." };

  // The starting mark anchors every future fee, so it must be a complete reading.
  const nav = await getNavStrict();
  if (!nav || nav.nav <= 0) return { error: "Could not read your full account value from Groww just now. Try again in a moment." };

  if (!(await enroll(uid, nav.nav))) return { error: "You are already a member. Leave first to start again." };
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

/** Leaving closes the open period first, at a complete live reading — so a
 *  fee already earned is billed, and nothing is billed on a loss. */
export async function leaveAction(): Promise<void> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return;
  // No usable Groww key → retrying can't help; say so and point at re-connect.
  if (!(await getBroker(uid))) redirect("/membership?leave=reconnect");
  const nav = await getNavStrict();
  if (!nav) redirect("/membership?leave=retry");
  // An emptied or debit account can always leave: nothing is above the peak.
  const invoice = await leave(uid, Math.max(0, nav.nav));
  if (invoice) {
    await notify(uid, { kind: "account", tone: "neutral", ...settlementNotice(invoice, { ended: true }), key: `settle-${invoice.id}` });
  }
  revalidatePath("/membership");
  redirect("/membership");
}
