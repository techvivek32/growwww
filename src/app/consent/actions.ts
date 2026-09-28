"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { recordConsent } from "@/lib/consent";
import { hasBroker } from "@/lib/users";
import { notify } from "@/lib/notifications";

export interface ConsentState {
  error?: string;
}

export async function acceptConsent(_prev: ConsentState, form: FormData): Promise<ConsentState> {
  const uid = await currentUserId();
  if (!uid || uid === OWNER_ID) return { error: "You are not signed in as a user account." };

  const signatureName = String(form.get("signature") ?? "").trim();
  if (signatureName.length < 3) return { error: "Type your full name to sign." };
  if (form.get("agree") !== "on") return { error: "Please tick the box confirming you have read and understood." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  const userAgent = h.get("user-agent") ?? "unknown";

  await recordConsent(uid, { signatureName, ip, userAgent });
  await notify(uid, {
    kind: "account",
    tone: "up",
    title: "Agreement accepted",
    body: "Thanks — your consent is recorded. Connect your broker to get started.",
    key: "consent-accepted",
  });

  // Next stop depends on whether a broker is already connected.
  redirect((await hasBroker(uid)) ? "/stocks/alerts" : "/connect-broker");
}
