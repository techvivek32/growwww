"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentUserId, startAdminView } from "@/lib/session";
import { clientIp } from "@/lib/clientIp";
import { logAdminAccess } from "@/lib/adminAccess";
import { MEMBER_HOME } from "@/lib/routes";
import { ADMIN_ID, isReservedId } from "@/lib/auth";
import { clearBroker, findById } from "@/lib/users";
import { setKycDecision, scheduleKycCall } from "@/lib/kyc";
import { getMembership, settlePeriod, settlementNotice, listInvoices, markInvoice } from "@/lib/membership";
import { notify } from "@/lib/notifications";
import { eraseAccount } from "@/lib/erase";
import { getNavFor } from "@/lib/api/broker";

/** Every admin action re-checks the caller is the admin login — never trust the UI. */
async function requireAdmin(): Promise<boolean> {
  return (await currentUserId()) === ADMIN_ID;
}

/**
 * Open a client's account exactly as they see it. The admin's own session is
 * kept aside for "Back to admin"; the view lasts an hour, every open and close
 * is logged, and steps that are the client's own act stay refused (see
 * ADMIN_VIEW_REFUSAL). The client's password is never needed or shown — it is
 * stored only as a one-way hash.
 */
export async function adminOpenAccount(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const userId = String(formData.get("userId") ?? "");
  if (!userId || isReservedId(userId) || !(await findById(userId))) return;
  if (!(await startAdminView(userId))) return;
  await logAdminAccess({ kind: "open", userId, ip: clientIp(await headers()) });
  redirect(MEMBER_HOME); // the usual gates then send it where the client would land
}

export async function adminDisconnectBroker(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const userId = String(formData.get("userId") ?? "");
  if (userId && !isReservedId(userId)) await clearBroker(userId);
  revalidatePath("/admin");
}

export async function adminDeleteUser(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const userId = String(formData.get("userId") ?? "");
  if (userId && !isReservedId(userId)) {
    const failed = await eraseAccount(userId);
    if (failed.length) console.error(`[erase] admin delete of ${userId} partly failed: ${failed.join(", ")}`);
  }
  revalidatePath("/admin");
}

export async function adminKycDecision(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
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
  if (!(await requireAdmin())) return;
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

/* ------------------------------------------------------------ hisab: fees */

export interface SettleState {
  ok?: string;
  error?: string;
}

const rupees = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

/**
 * Close a member's performance period on a LIVE read of their account value,
 * taken with that member's own stored Groww creds. Never a typed number and
 * never the stale last-known NAV: if the live read fails, nothing is settled.
 * Before the period's end it refuses unless `force` was ticked.
 */
export async function adminSettleMember(_prev: SettleState, formData: FormData): Promise<SettleState> {
  if (!(await requireAdmin())) return { error: "Admin only." };
  const userId = String(formData.get("userId") ?? "");
  const seenEnd = Number(formData.get("periodEndsAt"));
  if (!userId || isReservedId(userId) || !Number.isFinite(seenEnd)) return { error: "Invalid request." };

  const m = await getMembership(userId);
  if (!m || m.status !== "active") return { error: "Not an active member — nothing to settle." };
  if (m.periodEndsAt !== seenEnd) {
    revalidatePath("/admin");
    return { error: "This period was already settled or changed — the page has been refreshed." };
  }
  // Periods close only after they end — never early, so a fee is never taken
  // on a gain that is still in the middle of its period.
  if (Date.now() < m.periodEndsAt) {
    return { error: "The period has not ended yet — it can be settled after it ends." };
  }

  const live = await getNavFor(userId);
  if (!live || !(live.nav > 0)) {
    return { error: "Could not read this member's live account value from Groww (not connected, key or IP not accepted, or Groww unreachable). Nothing was settled." };
  }

  const invoice = await settlePeriod(userId, live.nav, { periodEndsAt: seenEnd });
  if (!invoice) {
    revalidatePath("/admin");
    return { error: "Nothing was settled — the membership changed meanwhile. The page has been refreshed." };
  }
  await notify(userId, { kind: "account", tone: "neutral", ...settlementNotice(invoice), key: `settle-${invoice.id}` });
  revalidatePath("/admin");
  return {
    ok: invoice.feeDue > 0
      ? `Settled at live NAV ${rupees(live.nav)} — fee due ${rupees(invoice.feeDue)}.`
      : `Settled at live NAV ${rupees(live.nav)} — no profit above the peak, no fee.`,
  };
}

/** Record that a due invoice was paid (out of band) or waived. Only from "due". */
export async function adminMarkInvoice(formData: FormData): Promise<void> {
  if (!(await requireAdmin())) return;
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("status") ?? "");
  if (!/^inv-[a-z0-9-]{1,40}$/.test(id) || (raw !== "paid" && raw !== "waived")) return;
  const status: "paid" | "waived" = raw;

  const iv = (await listInvoices()).find((x) => x.id === id);
  if (!iv || iv.status !== "due") return;
  await markInvoice(id, status);
  // The invoice outlives a deleted account; never write a notification for it.
  if (status === "paid" && (await findById(iv.userId))) {
    await notify(iv.userId, {
      kind: "account",
      tone: "up",
      title: "Payment received",
      body: `We have recorded your payment of ${rupees(iv.feeDue)} for the performance period that closed on ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iv.periodEnd))}. Thank you.`,
      key: `paid-${iv.id}`,
    });
  }
  revalidatePath("/admin");
}
