"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUserId, ADMIN_VIEW_REFUSAL, inAdminView } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { getNavStrict } from "@/lib/api/broker";
import { getBroker } from "@/lib/users";
import { enroll, leave, settlementNotice } from "@/lib/membership";
import { notify, notifyAdmin } from "@/lib/notifications";

export interface MemberState {
  error?: string;
}

export async function enrollAction(_prev: MemberState, _form: FormData): Promise<MemberState> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return { error: "Sign in as a user account first." };
  if (await inAdminView()) return { error: ADMIN_VIEW_REFUSAL };
  // Not offered: members make their own trades, so a performance fee would be
  // charged on gains MNHA had no part in.
  if (uid) return { error: "Membership is not offered at present." };

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
  await notifyAdmin({
    tone: "up",
    route: "admin:members",
    title: "New member enrolled",
    body: `A client started a performance period at ₹${Math.round(nav.nav).toLocaleString("en-IN")}.`,
    key: `member-admin-${uid}-${Date.now()}`,
  });
  revalidatePath("/membership");
  return {};
}

/** Leaving closes the open period first, at a complete live reading — so a
 *  fee already earned is billed, and nothing is billed on a loss. */
export async function leaveAction(): Promise<void> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid) || (await inAdminView())) return;
  // No usable Groww key → retrying can't help; say so and point at re-connect.
  if (!(await getBroker(uid))) redirect("/membership?leave=reconnect");
  const nav = await getNavStrict();
  if (!nav) redirect("/membership?leave=retry");
  // An emptied or debit account can always leave: nothing is above the peak.
  const invoice = await leave(uid, Math.max(0, nav.nav));
  if (invoice) {
    await notify(uid, { kind: "account", tone: "neutral", ...settlementNotice(invoice, { ended: true }), key: `settle-${invoice.id}` });
    // A member leaving closes their period there and then. If that left a fee
    // due, it is collected out of band by a person — who has to know it exists.
    await notifyAdmin({
      tone: invoice.feeDue > 0 ? "warn" : "neutral",
      route: "admin:fees",
      title: invoice.feeDue > 0 ? "A member left — fee due" : "A member left — no fee",
      body:
        invoice.feeDue > 0
          ? `Their period was settled on the way out. ₹${Math.round(invoice.feeDue).toLocaleString("en-IN")} is due and is collected separately.`
          : "Their period was settled on the way out with no profit above the previous peak, so there is nothing to collect.",
      key: `settle-admin-${invoice.id}`,
    });
  }
  revalidatePath("/membership");
  redirect("/membership");
}
