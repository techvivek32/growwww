import { type NextRequest } from "next/server";
import { clientIp } from "@/lib/clientIp";
import { SESSION_MAX_AGE, issueToken, isReservedEmail } from "@/lib/auth";
import {
  validateSignup,
  hashForSignup,
  normalizeEmail,
  findByEmail,
  createVerifiedUser,
} from "@/lib/users";
import { startPending, verifyCode, resendCode, pendingEmail, dropPending } from "@/lib/signupOtp";
import { sendSignupCode, sendAlreadyRegistered } from "@/lib/signupMail";
import { mailConfigured } from "@/lib/mailer";
import { maskEmail } from "@/lib/signupFlow";
import { rateLimit } from "@/lib/ratelimit";
import { notify, notifyAdmin } from "@/lib/notifications";
import { json, fail, roleOf } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/signup — registration, mirroring src/app/signup/actions.ts.
 *
 * Three steps in one route, chosen by `step`:
 *   start   { email, password }  → mails a code, returns a pending token
 *   verify  { token, code }      → creates the account, returns a session
 *   resend  { token }            → mails the code again
 *
 * The "already registered" case deliberately looks identical from outside: a
 * notice is mailed instead of a code, and the response has the same shape, so
 * verification simply never succeeds for it. Telling an unauthenticated
 * caller which addresses exist would turn sign-up into an enumeration oracle.
 *
 * Without SMTP in development the code is printed to the server console, the
 * same as the web form does.
 */
async function deliver(kind: "code" | "existing", to: string, code: string): Promise<boolean> {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[signup/mobile] (dev, no SMTP) ${
          kind === "code" ? `code for ${to}: ${code}` : `${to} already registered`
        }`,
      );
      return true;
    }
    return false;
  }
  return kind === "code" ? sendSignupCode(to, code) : sendAlreadyRegistered(to);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail("Expected a JSON body.", 400);
  }

  const step = String(body.step ?? "");
  const ip = clientIp(req.headers);

  /* ------------------------------------------------------------- start */
  if (step === "start") {
    const email = normalizeEmail(String(body.email ?? ""));
    const password = String(body.password ?? "");

    // Same budget and key shape as the web form, so attempts from a phone and
    // a browser share one bucket rather than doubling the allowance.
    if (!rateLimit(`signup:${ip}`, 8, 60 * 60_000).ok) {
      return fail("Too many sign-ups from here. Please try again later.", 429);
    }

    const invalid = validateSignup(email, password);
    if (invalid) return fail(invalid, 400);
    if (isReservedEmail(email)) return fail("That address cannot be registered.", 400);

    const existing = Boolean(await findByEmail(email));
    const { token, code } = await startPending(email, hashForSignup(password), existing);
    if (!(await deliver(existing ? "existing" : "code", email, code))) {
      return fail("Could not send the verification email. Please try again later.", 502);
    }
    return json({ step: "verify", token, maskedEmail: maskEmail(email) });
  }

  /* ------------------------------------------------------------ resend */
  if (step === "resend") {
    const token = String(body.token ?? "");
    const email = await pendingEmail(token);
    if (!email) return fail("That sign-up has expired. Please start again.", 410);

    const r = await resendCode(token);
    if (!r.ok) {
      const message =
        r.reason === "cooldown"
          ? `Please wait ${Math.ceil((r.waitMs ?? 0) / 1000)}s before asking for another code.`
          : r.reason === "limit"
            ? "Too many codes sent. Please start again."
            : "That sign-up has expired. Please start again.";
      return fail(message, r.reason === "cooldown" ? 429 : 410);
    }

    if (!(await deliver(r.existing ? "existing" : "code", r.email, r.code))) {
      return fail("Could not send the verification email.", 502);
    }
    return json({ ok: true, maskedEmail: maskEmail(r.email) });
  }

  /* ------------------------------------------------------------ verify */
  if (step === "verify") {
    const token = String(body.token ?? "");
    const code = String(body.code ?? "").trim();
    if (!code) return fail("Enter the code from your email.", 400);

    const r = await verifyCode(token, code);
    if (!r.ok) {
      const message =
        r.reason === "locked"
          ? "Too many wrong codes. Please start again."
          : r.reason === "expired"
            ? "That code has expired. Please start again."
            : "That code is not right.";
      return fail(message, r.reason === "wrong" ? 400 : 410);
    }

    const created = await createVerifiedUser(r.email, r.passwordHash);
    await dropPending(token);
    if (!created.user) return fail(created.error ?? "Could not create the account.", 400);

    // The same two notices the web's signup action writes. Without these,
    // signing up ON THE PHONE produced an account with an empty notification
    // feed and told the admin nothing — the one path where a new client could
    // appear with no trace anywhere a person looks. This route is meant to be
    // a thin projection of the web flow; it was missing this half of it.
    await notify(created.user.id, {
      kind: "account",
      tone: "up",
      title: "Welcome to MNHA Financials",
      body:
        "Your email is verified. Connect your Groww account to see it here. Section 4 of the " +
        "agreement explains how MNHA's automatic intraday strategy trades connected accounts.",
      key: "welcome",
    });
    await notifyAdmin({
      tone: "up",
      route: "admin:accounts",
      title: "New account created",
      body: `${r.email} verified their email and signed up. They have not signed the agreement yet.`,
      key: `signup-${created.user.id}`,
    });

    const sessionToken = await issueToken(created.user.id);
    const res = json({
      token: sessionToken,
      userId: created.user.id,
      role: roleOf(created.user.id),
      // A new account has signed nothing and connected nothing, so the
      // agreement comes first — the same order the web uses.
      next: "/consent",
      expiresInSec: SESSION_MAX_AGE,
    });
    res.cookies.set("mnha_session", sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  }

  return fail('step must be "start", "verify" or "resend".', 400);
}
