"use server";

import { redirect } from "next/navigation";
import { setBroker } from "@/lib/users";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { runWithCreds } from "@/lib/api/credctx";
import { rateLimit } from "@/lib/ratelimit";
import { notify } from "@/lib/notifications";
import { probeConnection, registeredIp, type ProbeStage } from "@/lib/api/groww";
import { classify } from "./parse";
import { MEMBER_HOME } from "@/lib/routes";

export type Check = "ok" | "fail" | "skip";

export interface FormState {
  error?: string;
  /** Which step failed, for the wizard to highlight. */
  stage?: "format" | ProbeStage;
  checks?: { keyFormat: Check; secretFormat: Check; token: Check; account: Check };
}

const HINT: Record<ProbeStage, (status: number | null) => string> = {
  auth: (s) =>
    `Groww did not accept this key and secret${s ? ` (HTTP ${s})` : ""}. Make sure the key is a TOTP key (not an access token or an API key + secret pair), that the secret is the one shown with this same key, and that the key has not been revoked. Generating a fresh TOTP key on Groww and pasting both again usually fixes it.`,
  account: (s) =>
    `The key works, but Groww refused to read the account${s ? ` (HTTP ${s})` : ""}. Check that your Groww Trading API subscription is active, then try again.`,
  rate: () => "Groww is rate-limiting sign-ins for this key right now. Wait a few minutes, then try again.",
  network: () => "We could not reach Groww just now. Nothing was saved — please try again in a moment.",
  ops: () => "A problem on our server stopped the check — not your key. Nothing was saved. Please try again shortly or contact support.",
};

/**
 * Store the user's own Groww API credentials — but only after a live probe
 * proves they authenticate and can read the account, so a typo is caught
 * here, not later on an empty portfolio. The probe runs in the entered creds'
 * context (never the house account); the keys are then encrypted at rest.
 */
export async function connectBroker(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await currentUserId();
  if (!userId || userId === OWNER_ID) return { error: "You are not signed in as a user account." };

  // Each attempt mints a Groww token, and Groww caps those per key per day.
  if (!rateLimit(`connect:${userId}`, 10, 15 * 60_000).ok) {
    return { error: "Too many attempts. Wait fifteen minutes, then try again.", stage: "rate" };
  }

  const key = classify(String(formData.get("apiKey") ?? ""));
  const secretRaw = classify(String(formData.get("totpSecret") ?? ""));
  const secret = secretRaw.kind === "otpauth" || secretRaw.kind === "totpSecret" ? secretRaw : null;
  const keyOk = key.kind === "apiKey";

  if (!keyOk || !secret) {
    const checks = { keyFormat: keyOk ? "ok" : "fail", secretFormat: secret ? "ok" : "fail", token: "skip", account: "skip" } as const;
    let error = "";
    if (!keyOk) error = "The API key should be the long token Groww shows for a TOTP key (it starts with “eyJ”). ";
    if (!secret) {
      error +=
        secretRaw.kind === "otpCode"
          ? "That 6-digit number is a one-time code — it expires in 30 seconds. Paste the secret text shown under the QR code instead."
          : "The TOTP secret should be the text shown beside the QR code (letters A–Z and digits 2–7).";
    }
    return { error: error.trim(), stage: "format", checks };
  }
  if (key.exp && key.exp < Date.now()) {
    return {
      error: "This key has expired on Groww. Generate a new TOTP key and paste it here.",
      stage: "auth",
      checks: { keyFormat: "fail", secretFormat: "ok", token: "skip", account: "skip" },
    };
  }

  const probe = await runWithCreds({ apiKey: key.value, totpSecret: secret.value }, () => probeConnection());
  if (!probe.ok) {
    return {
      error: HINT[probe.stage](probe.status),
      stage: probe.stage,
      checks: {
        keyFormat: "ok",
        secretFormat: "ok",
        token: probe.minted ? "ok" : probe.stage === "auth" || probe.stage === "rate" ? "fail" : "skip",
        account: probe.minted ? "fail" : "skip",
      },
    };
  }

  const ip = registeredIp();
  const saved = await setBroker(userId, key.value, secret.value, {
    staticIp: ip ?? undefined,
    ipConfirmed: ip !== null && formData.get("ipConfirmed") === "on",
    ucc: probe.ucc,
  });
  if (!saved) return { error: "Could not save the connection. Try again." };

  await notify(userId, {
    kind: "broker",
    tone: "up",
    title: "Groww connected",
    body: "Your Groww account is linked. Your keys are encrypted and used only for your account.",
    key: "broker-connected",
  });
  redirect(MEMBER_HOME);
}
