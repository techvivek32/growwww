"use server";

import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/clientIp";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, ADMIN_BACK_COOKIE, ADMIN_ID, OWNER_ID, issueToken, isAdminLogin, isOwnerLogin } from "@/lib/auth";
import { adminViewUserId, endAdminView } from "@/lib/session";
import { logAdminAccess } from "@/lib/adminAccess";
import { verifyLogin, hasBroker } from "@/lib/users";
import { hasConsented } from "@/lib/consent";
import { rateLimit, rateReset } from "@/lib/ratelimit";
import { ADMIN_HOME, MEMBER_HOME, OWNER_HOME } from "@/lib/routes";

export interface FormState {
  error?: string;
}

/** A best-effort client key from the proxy headers, for rate limiting. */
async function clientKey(): Promise<string> {
  const h = await headers();
  return clientIp(h);
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
  jar.delete(ADMIN_BACK_COOKIE); // a fresh sign-in ends any earlier admin view
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

  // The env logins first — the admin console, then the "house" owner — then
  // registered users.
  if (isAdminLogin(email, password)) {
    rateReset(key);
    await setSession(ADMIN_ID);
    redirect(ADMIN_HOME);
  }
  if (isOwnerLogin(email, password)) {
    rateReset(key);
    await setSession(OWNER_ID);
    redirect(OWNER_HOME);
  }

  const user = await verifyLogin(email, password);
  if (!user) return { error: "That email and password do not match." };

  rateReset(key);
  await setSession(user.id);
  // Agreement first, then broker, then the terminal.
  if (!(await hasConsented(user.id))) redirect("/consent");
  redirect((await hasBroker(user.id)) ? MEMBER_HOME : "/connect-broker");
}

export async function logout() {
  // Inside a client's account, "Sign out" leaves the account and returns to the console.
  if (await adminViewUserId()) return exitAdminView();
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ADMIN_BACK_COOKIE);
  redirect("/login");
}

/** Leave the client's account the admin opened, back to the admin console. */
export async function exitAdminView() {
  const viewed = await adminViewUserId();
  if (viewed) await logAdminAccess({ kind: "close", userId: viewed, ip: clientIp(await headers()) });
  redirect((await endAdminView()) ? ADMIN_HOME : "/login");
}
