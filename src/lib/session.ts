import "server-only";
import { cookies } from "next/headers";
import {
  ADMIN_BACK_COOKIE,
  ADMIN_ID,
  ADMIN_VIEW_TTL_MS,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  issueToken,
  isReservedId,
  sessionInfo,
  sessionUserId,
} from "./auth";

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

/** Set the signed session cookie for a user id (or OWNER_ID). */
export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await issueToken(userId), cookieOpts(SESSION_MAX_AGE));
  jar.delete(ADMIN_BACK_COOKIE); // a fresh sign-in ends any earlier admin view
}

/** The signed-in user id for this request, or null. */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  return sessionUserId(jar.get(SESSION_COOKIE)?.value);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(ADMIN_BACK_COOKIE);
}

/* -------------------------------------------------------------- admin view */

/** The client whose account the admin is inside right now, or null. */
export async function adminViewUserId(): Promise<string | null> {
  const info = await sessionInfo((await cookies()).get(SESSION_COOKIE)?.value);
  return info?.adminView ? info.userId : null;
}

/**
 * The admin opens a client's account: the admin's own session is parked in a
 * second cookie and the session becomes the client's, marked as an admin view
 * and limited to one hour. Only an admin session can start one.
 */
export async function startAdminView(userId: string): Promise<boolean> {
  if (!userId || isReservedId(userId)) return false;
  const jar = await cookies();
  const adminToken = jar.get(SESSION_COOKIE)?.value;
  if ((await sessionUserId(adminToken)) !== ADMIN_ID || !adminToken) return false;
  jar.set(ADMIN_BACK_COOKIE, adminToken, cookieOpts(SESSION_MAX_AGE));
  jar.set(SESSION_COOKIE, await issueToken(userId, { ttlMs: ADMIN_VIEW_TTL_MS, adminView: true }), cookieOpts(ADMIN_VIEW_TTL_MS / 1000));
  return true;
}

/** Leave the client's account. True when the admin's own session is back;
 *  false when it had expired meanwhile (then everything is signed out). */
export async function endAdminView(): Promise<boolean> {
  const jar = await cookies();
  const back = jar.get(ADMIN_BACK_COOKIE)?.value;
  jar.delete(ADMIN_BACK_COOKIE);
  if (back && (await sessionUserId(back)) === ADMIN_ID) {
    jar.set(SESSION_COOKIE, back, cookieOpts(SESSION_MAX_AGE));
    return true;
  }
  jar.delete(SESSION_COOKIE);
  return false;
}

/**
 * Steps that are the client's own act — signing or changing a consent,
 * identity photos, the Groww key, password, membership, deleting the account —
 * are refused while the admin is viewing their account.
 */
export const ADMIN_VIEW_REFUSAL = "Admin view: only the client can do this, from their own sign-in.";

export async function inAdminView(): Promise<boolean> {
  return (await adminViewUserId()) !== null;
}
