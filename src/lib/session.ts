import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, issueToken, sessionUserId } from "./auth";

/** Set the signed session cookie for a user id (or OWNER_ID). */
export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await issueToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** The signed-in user id for this request, or null. */
export async function currentUserId(): Promise<string | null> {
  const jar = await cookies();
  return sessionUserId(jar.get(SESSION_COOKIE)?.value);
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
