import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/clientIp";
import { SESSION_MAX_AGE, ADMIN_ID, OWNER_ID, issueToken, isAdminLogin, isOwnerLogin } from "@/lib/auth";
import { verifyLogin, hasBroker } from "@/lib/users";
import { hasConsented } from "@/lib/consent";
import { rateLimit, rateReset } from "@/lib/ratelimit";
import { ADMIN_HOME, MEMBER_HOME, OWNER_HOME } from "@/lib/routes";
import { json, fail, roleOf } from "@/lib/mobileApi";

/**
 * POST /api/mobile/login — the one public route under /api/mobile/.
 *
 * Deliberately mirrors `src/app/login/actions.ts` step for step: the same
 * rate limit, the same order of checks (admin env login, then owner env
 * login, then registered users), the same token. Two sign-in paths that drift
 * apart is how a phone ends up able to log in with credentials the web has
 * already revoked, so this file should be read next to that one.
 *
 * What differs is only the shape of the answer: the web redirects, this
 * returns the token and the destination and lets the client route itself.
 */
export async function POST(req: NextRequest) {
  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "");
    password = String(body?.password ?? "");
  } catch {
    return fail("Expected a JSON body with email and password.", 400);
  }

  if (!email.trim() || !password) return fail("Email and password are required.", 400);

  // Same budget as the web form, and the same key shape, so attempts from a
  // phone and a browser share one bucket rather than doubling the allowance.
  const key = `login:${clientIp(req.headers)}:${email.trim().toLowerCase()}`;
  const limit = rateLimit(key, 8, 15 * 60_000);
  if (!limit.ok) {
    return fail(
      `Too many attempts. Try again in about ${Math.ceil(limit.retryAfterSec / 60)} minutes.`,
      429,
    );
  }

  const ok = async (userId: string, next: string): Promise<NextResponse> => {
    rateReset(key);
    const token = await issueToken(userId);
    const res = json({
      token,
      userId,
      role: roleOf(userId),
      next,
      expiresInSec: SESSION_MAX_AGE,
    });
    // Also set the cookie, so a WebView opened from inside the app (the KYC
    // and consent flows are camera-bound and stay on the web) is already
    // signed in rather than bouncing the user to a second login.
    res.cookies.set("mnha_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  };

  // The homes come from lib/routes.ts rather than being written out here, so
  // a change on the web side cannot leave the app sending people to a page
  // that no longer exists. It already did once: OWNER_HOME moved from
  // /stocks/alerts to /ai when the signals sections were removed, and a
  // hardcoded copy here kept pointing at the deleted page.
  if (isAdminLogin(email, password)) return ok(ADMIN_ID, ADMIN_HOME);
  if (isOwnerLogin(email, password)) return ok(OWNER_ID, OWNER_HOME);

  const user = await verifyLogin(email, password);
  // One message for both a wrong address and a wrong password: saying which
  // was wrong tells an attacker which addresses are registered.
  if (!user) return fail("That email and password do not match.", 401);

  // Same gate order as the web: agreement first, then a connected broker.
  if (!(await hasConsented(user.id))) return ok(user.id, "/consent");
  return ok(user.id, (await hasBroker(user.id)) ? MEMBER_HOME : "/connect-broker");
}
