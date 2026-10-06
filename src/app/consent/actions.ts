"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { clientIp } from "@/lib/clientIp";
import { currentUserId, ADMIN_VIEW_REFUSAL, inAdminView } from "@/lib/session";
import { isReservedId } from "@/lib/auth";
import { recordConsent, CONSENT_KEYS, CONTRACT, type ConsentKey, type Lang } from "@/lib/consent";
import { mediaStatus, readMediaMeta } from "@/lib/consentMedia";
import { revokeHandoffs } from "@/lib/kycHandoff";
import { hasBroker } from "@/lib/users";
import { notify } from "@/lib/notifications";
import { MEMBER_HOME } from "@/lib/routes";

export interface ConsentState {
  error?: string;
}

const LANGS = new Set<Lang>(["en", "hi", "gu"]);
/** Media for a signing must have been recorded for it — within the last day. */
const MEDIA_MAX_AGE_MS = 24 * 3600 * 1000;

export async function acceptConsent(_prev: ConsentState, form: FormData): Promise<ConsentState> {
  const raw = String(form.get("language") ?? "en") as Lang;
  const language: Lang = LANGS.has(raw) ? raw : "en";
  const ui = CONTRACT[language].ui;

  const uid = await currentUserId();
  if (!uid || isReservedId(uid)) return { error: "You are not signed in as a user account." };
  // The agreement is signed by the client in person — never by the admin on their behalf.
  if (await inAdminView()) return { error: ADMIN_VIEW_REFUSAL };

  const signatureName = String(form.get("signature") ?? "").trim();
  if (signatureName.length < 3) return { error: ui.signName };

  // Each consent is its own box, never pre-ticked; the four required ones must all be given.
  const consents = Object.fromEntries(CONSENT_KEYS.map(({ key }) => [key, form.get(`c_${key}`) === "on"])) as Record<ConsentKey, boolean>;
  if (CONSENT_KEYS.some(({ key, required }) => required && !consents[key])) return { error: ui.needRequired };

  // The selfie and ID photo must be uploaded — and taken for THIS signing.
  const media = await mediaStatus(uid, MEDIA_MAX_AGE_MS);
  if (!media.selfie || !media.id) return { error: ui.needMedia };

  const viewed = String(form.get("viewed") ?? "")
    .split(",")
    .filter((l): l is Lang => LANGS.has(l as Lang));
  const languagesViewed = Array.from(new Set<Lang>([...viewed, language]));

  const h = await headers();
  const ip = clientIp(h, "unknown");
  const userAgent = h.get("user-agent") ?? "unknown";

  await recordConsent(uid, {
    signatureName,
    language,
    ip,
    userAgent,
    media: { selfie: media.selfie, idPhoto: media.id, video: false, liveness: (await readMediaMeta(uid, "selfie"))?.liveness?.passed === true },
    consents,
    languagesViewed,
  });
  revokeHandoffs(uid); // the phone link has done its job
  await notify(uid, {
    kind: "account",
    tone: "up",
    title: "Agreement accepted",
    body: "Thanks — your consents and identity photos are recorded. Connect your broker to get started.",
    key: "consent-accepted",
  });

  redirect((await hasBroker(uid)) ? MEMBER_HOME : "/connect-broker");
}
