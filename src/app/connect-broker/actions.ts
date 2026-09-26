"use server";

import { redirect } from "next/navigation";
import { setBroker } from "@/lib/users";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { runWithCreds } from "@/lib/api/credctx";
import { notify } from "@/lib/notifications";
import * as groww from "@/lib/api/groww";

export interface FormState {
  error?: string;
}

/**
 * Store the user's own Groww API credentials — but only after a live probe
 * proves they actually authenticate, so a typo is caught here, not later on an
 * empty portfolio. The probe runs inside the entered creds' context; the keys
 * are then encrypted at rest by setBroker.
 */
export async function connectBroker(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await currentUserId();
  if (!userId || userId === OWNER_ID) return { error: "You are not signed in as a user account." };

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const totpSecret = String(formData.get("totpSecret") ?? "").trim().replace(/\s+/g, "");
  if (!apiKey || !totpSecret) return { error: "Enter both the API key and the TOTP secret." };

  // Live check: mint a token and read the margin with these exact creds.
  const ok = await runWithCreds({ apiKey, totpSecret }, async () => {
    try {
      return (await groww.getMargin()) !== null;
    } catch {
      return false;
    }
  });
  if (!ok) {
    return { error: "Those credentials did not authenticate with Groww. Check the API key and TOTP secret." };
  }

  const saved = await setBroker(userId, apiKey, totpSecret);
  if (!saved) return { error: "Could not save the connection. Try again." };

  await notify(userId, {
    kind: "broker",
    tone: "up",
    title: "Broker connected",
    body: "Your Groww account is linked. Your keys are encrypted and used only for your account.",
    key: "broker-connected",
  });
  redirect("/stocks/alerts");
}
