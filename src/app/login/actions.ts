"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, OWNER_ID, issueToken, isOwnerLogin } from "@/lib/auth";
import { verifyLogin, hasBroker } from "@/lib/users";
import { rateLimit, rateReset } from "@/lib/ratelimit";

export interface FormState {
  error?: string;
}

/** A best-effort client key from the proxy headers, for rate limiting. */
async function clientKey(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await issueToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  // Throttle by IP + email so a password cannot be brute-forced.
  const key = `login:${await clientKey()}:${email.trim().toLowerCase()}`;
  const limit = rateLimit(key, 8, 15 * 60_000);
  if (!limit.ok) {
    return { error: `Too many attempts. Try again in about ${Math.ceil(limit.retryAfterSec / 60)} minutes.` };
  }

  // The env "house" owner first, then registered users.
  if (isOwnerLogin(email, password)) {
    rateReset(key);
    await setSession(OWNER_ID);
    redirect("/stocks/alerts");
  }

  const user = await verifyLogin(email, password);
  if (!user) return { error: "That email and password do not match." };

  rateReset(key);
  await setSession(user.id);
  // Straight to connecting a broker if they have not yet — the terminal is
  // empty without it.
  redirect((await hasBroker(user.id)) ? "/stocks/alerts" : "/connect-broker");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
