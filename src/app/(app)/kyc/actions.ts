"use server";

import { revalidatePath } from "next/cache";
import { currentUserId, ADMIN_VIEW_REFUSAL, inAdminView } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { replaceKycPhotos, submitKyc } from "@/lib/kyc";
import { notify } from "@/lib/notifications";
import { rateLimit } from "@/lib/ratelimit";

export interface KycState {
  error?: string;
  ok?: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file
const IMG = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOC = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

async function readFilePart(
  form: FormData,
  field: string,
  allowed: Set<string>,
  required: boolean,
): Promise<{ ok: true; value: { buffer: Buffer; name: string } | null } | { ok: false; error: string }> {
  const f = form.get(field);
  if (!(f instanceof File) || f.size === 0) {
    return required ? { ok: false, error: `A ${field} is required.` } : { ok: true, value: null };
  }
  if (f.size > MAX_BYTES) return { ok: false, error: `Your ${field} is larger than 5 MB.` };
  if (!allowed.has(f.type)) return { ok: false, error: `The ${field} must be a JPG, PNG${allowed.has("application/pdf") ? " or PDF" : ""} file.` };
  return { ok: true, value: { buffer: Buffer.from(await f.arrayBuffer()), name: f.name } };
}

export async function submitKycAction(_prev: KycState, form: FormData): Promise<KycState> {
  const uid = await currentUserId();
  if (!uid) return { error: "Your session expired. Sign in again." };
  if (isReservedId(uid)) return { error: "This account does not need identity verification." };
  if (await inAdminView()) return { error: ADMIN_VIEW_REFUSAL };
  if (!rateLimit(`kyc:${uid}`, 5, 60 * 60_000).ok) return { error: "Too many attempts. Try again later." };

  if (form.get("consent") !== "on") {
    return { error: "Please tick the consent box to submit your details for verification." };
  }

  const selfie = await readFilePart(form, "selfie", IMG, true);
  if (!selfie.ok) return { error: selfie.error };
  const doc = await readFilePart(form, "doc", DOC, false);
  if (!doc.ok) return { error: doc.error };

  const res = await submitKyc(uid, {
    fullName: String(form.get("fullName") ?? ""),
    pan: String(form.get("pan") ?? ""),
    dob: String(form.get("dob") ?? ""),
    address: String(form.get("address") ?? ""),
    selfie: selfie.value,
    doc: doc.value,
  });
  if (!res.ok) return { error: res.error };

  await notify(uid, {
    kind: "account",
    tone: "neutral",
    title: "Verification submitted",
    body: "Your details are in review. We'll schedule a short live video call to confirm your identity.",
    key: "kyc-submitted",
  });
  revalidatePath("/kyc");
  return { ok: true };
}

/**
 * Replace the photos on a submission that is still in review.
 *
 * The common case is a bad shot: a blurred selfie, the wrong side of the card,
 * the wrong document entirely. Making someone re-enter name, PAN, date of
 * birth and address to fix a photo is how a verification stalls, so this path
 * takes files only.
 */
export async function retakeKycPhotosAction(_prev: KycState, form: FormData): Promise<KycState> {
  const uid = await currentUserId();
  if (!uid) return { error: "Your session expired. Sign in again." };
  if (isReservedId(uid)) return { error: "This account does not need identity verification." };
  if (await inAdminView()) return { error: ADMIN_VIEW_REFUSAL };
  if (!rateLimit(`kyc-retake:${uid}`, 6, 60 * 60_000).ok) {
    return { error: "Too many photo changes in a row. Try again a little later." };
  }

  const selfie = await readFilePart(form, "selfie", IMG, false);
  if (!selfie.ok) return { error: selfie.error };
  const doc = await readFilePart(form, "doc", DOC, false);
  if (!doc.ok) return { error: doc.error };
  if (!selfie.value && !doc.value) return { error: "Choose a new selfie or ID photo to replace." };

  const res = await replaceKycPhotos(uid, { selfie: selfie.value, doc: doc.value });
  if (!res.ok) return { error: res.error };

  await notify(uid, {
    kind: "account",
    tone: "neutral",
    title: "Verification photos updated",
    body: "Your new photo is with the reviewer. Your other details are unchanged.",
    key: "kyc-photos-updated",
  });
  revalidatePath("/kyc");
  return { ok: true };
}
