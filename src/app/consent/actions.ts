"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentUserId } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { recordConsent, type Lang } from "@/lib/consent";
import { hasAllMedia } from "@/lib/consentMedia";
import { hasBroker } from "@/lib/users";
import { notify } from "@/lib/notifications";
import { MEMBER_HOME } from "@/lib/routes";

export interface ConsentState {
  error?: string;
}

const LANGS = new Set(["en", "hi", "gu"]);

export async function acceptConsent(_prev: ConsentState, form: FormData): Promise<ConsentState> {
  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return { error: "You are not signed in as a user account." };

  const signatureName = String(form.get("signature") ?? "").trim();
  const language = (String(form.get("language") ?? "en")) as Lang;
  if (!LANGS.has(language)) return { error: "Invalid language." };
  if (signatureName.length < 3) return { error: "Type your full name to sign." };
  if (form.get("agree") !== "on") return { error: "Please tick the box confirming you have read and understood." };

  // The identity + acknowledgement media must already be uploaded.
  const media = await hasAllMedia(uid);
  if (!media.selfie || !media.id || !media.video) {
    return { error: "Please add your selfie, PAN/Aadhaar photo, and the spoken video before signing." };
  }

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  const userAgent = h.get("user-agent") ?? "unknown";

  await recordConsent(uid, {
    signatureName,
    language,
    ip,
    userAgent,
    media: { selfie: media.selfie, idPhoto: media.id, video: media.video },
  });
  await notify(uid, {
    kind: "account",
    tone: "up",
    title: "Agreement accepted",
    body: "Thanks — your consent, identity photos and video are recorded. Connect your broker to get started.",
    key: "consent-accepted",
  });

  redirect((await hasBroker(uid)) ? MEMBER_HOME : "/connect-broker");
}
