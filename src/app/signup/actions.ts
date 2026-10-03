"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { clientIp } from "@/lib/clientIp";
import { createVerifiedUser, findByEmail, hashForSignup, normalizeEmail, validateSignup } from "@/lib/users";
import { isReservedEmail } from "@/lib/auth";
import { setSession } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { notify } from "@/lib/notifications";
import { mailConfigured } from "@/lib/mailer";
import { sendAlreadyRegistered, sendSignupCode } from "@/lib/signupMail";
import { CODE_TTL_MS, dropPending, pendingEmail, resendCode, startPending, verifyCode } from "@/lib/signupOtp";

/**
 * Sign-up in two steps: details, then the 6-digit code emailed to the address.
 * No account exists until the code is entered. The screens look the same
 * whether or not the address is already registered (that address is emailed
 * a "you already have an account" note instead), so the form cannot be used
 * to discover who has an account.
 */

export interface FormState {
  step?: "details" | "code";
  email?: string;
  error?: string;
  info?: string;
}

const COOKIE = "mnha_signup";

async function requestIp(): Promise<string> {
  const h = await headers();
  return clientIp(h);
}

function mask(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/** Without SMTP in development, the code is printed to the server console. */
async function deliver(kind: "code" | "existing", to: string, code: string): Promise<boolean> {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[signup] (dev, no SMTP) ${kind === "code" ? `code for ${to}: ${code}` : `${to} already registered`}`);
      return true;
    }
    return false;
  }
  return kind === "code" ? sendSignupCode(to, code) : sendAlreadyRegistered(to);
}

async function start(form: FormData): Promise<FormState> {
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  // Cap sign-up attempts per client and per address, so this cannot be used to flood inboxes.
  if (!rateLimit(`signup:${await requestIp()}`, 8, 60 * 60_000).ok) {
    return { step: "details", error: "Too many sign-ups from here. Please try again later." };
  }
  const invalid = validateSignup(email, password);
  if (invalid) return { step: "details", error: invalid };
  if (password !== confirm) return { step: "details", error: "The two passwords do not match." };
  if (!rateLimit(`signup-mail:${email}`, 5, 60 * 60_000).ok) {
    return { step: "details", error: "Too many codes sent to this address. Please try again in an hour." };
  }

  const existing = isReservedEmail(email) || (await findByEmail(email)) !== null;
  const { token, code } = await startPending(email, hashForSignup(password), existing);
  const sent = await deliver(existing ? "existing" : "code", email, code);
  if (!sent) {
    await dropPending(token);
    return { step: "details", error: "We couldn't send the email just now. Please try again in a minute." };
  }
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(CODE_TTL_MS / 1000) + 60,
  });
  return { step: "code", email: mask(email) };
}

async function verify(form: FormData): Promise<FormState> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? "";
  const email = token ? await pendingEmail(token) : null;
  if (!token || !email) return { step: "details", error: "That code has expired. Please sign up again." };

  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { step: "code", email: mask(email), error: "Enter the 6-digit code from the email." };

  const res = await verifyCode(token, code);
  if (!res.ok) {
    if (res.reason === "expired") return { step: "details", error: "That code has expired. Please sign up again." };
    if (res.reason === "locked") return { step: "code", email: mask(email), error: "Too many wrong codes. Request a new code." };
    return { step: "code", email: mask(email), error: "That code is not right. Check the latest email and try again." };
  }

  const created = await createVerifiedUser(res.email, res.passwordHash);
  if (!created.ok || !created.user) return { step: "details", error: created.error ?? "Could not create the account." };
  jar.delete(COOKIE);

  await notify(created.user.id, {
    kind: "account",
    tone: "up",
    title: "Welcome to MNHA Financials",
    body: "Your email is verified. Connect your Groww account to see it here, read-only. MNHA places no orders on your account.",
    key: "welcome",
  });
  await setSession(created.user.id);
  // First stop: read and sign the user agreement.
  redirect("/consent");
}

async function resend(): Promise<FormState> {
  const token = (await cookies()).get(COOKIE)?.value ?? "";
  if (!token) return { step: "details", error: "That code has expired. Please sign up again." };
  const r = await resendCode(token);
  if (!r.ok) {
    if (r.reason === "expired") return { step: "details", error: "That code has expired. Please sign up again." };
    const email = (await pendingEmail(token)) ?? "";
    if (r.reason === "cooldown") {
      return { step: "code", email: mask(email), error: `Please wait ${Math.ceil((r.waitMs ?? 0) / 1000)} seconds before asking again.` };
    }
    return { step: "code", email: mask(email), error: "Too many codes for this sign-up. Start again in a while." };
  }
  const sent = await deliver(r.existing ? "existing" : "code", r.email, r.code);
  return sent
    ? { step: "code", email: mask(r.email), info: "A new code is on its way." }
    : { step: "code", email: mask(r.email), error: "We couldn't send the email just now. Please try again in a minute." };
}

async function restart(): Promise<FormState> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await dropPending(token);
  jar.delete(COOKIE);
  return { step: "details" };
}

export async function signup(_prev: FormState, form: FormData): Promise<FormState> {
  switch (String(form.get("intent") ?? "start")) {
    case "verify":
      return verify(form);
    case "resend":
      return resend();
    case "restart":
      return restart();
    default:
      return start(form);
  }
}
