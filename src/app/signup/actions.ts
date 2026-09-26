"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createUser } from "@/lib/users";
import { setSession } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { notify } from "@/lib/notifications";

export interface FormState {
  error?: string;
}

export async function signup(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Cap new-account creation per client, so signup cannot be used to flood.
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
  if (!rateLimit(`signup:${ip}`, 5, 60 * 60_000).ok) {
    return { error: "Too many sign-ups from here. Please try again later." };
  }

  if (password !== confirm) return { error: "The two passwords do not match." };

  const res = await createUser(email, password);
  if (!res.ok || !res.user) return { error: res.error ?? "Could not create the account." };

  await notify(res.user.id, {
    kind: "account",
    tone: "up",
    title: "Welcome to MNHA Financials",
    body: "Connect your Groww account to bring the terminal to life. You confirm every order yourself — nothing trades on its own.",
    key: "welcome",
  });
  await setSession(res.user.id);
  // A fresh account has no broker yet — go connect one.
  redirect("/connect-broker");
}
