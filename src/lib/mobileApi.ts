import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionInfo, isReservedId } from "@/lib/auth";
import { findById } from "@/lib/users";
import { OWNER_ID, ADMIN_ID } from "@/lib/auth";

/**
 * Shared plumbing for the mobile JSON API (`/api/mobile/*`), which exists so
 * the Flutter app has something to read. The web app is server-rendered: its
 * screens call `lib/` functions directly and never cross a JSON boundary, so
 * before this there was no endpoint a native client could use.
 *
 * The design rule here is that these routes are a *thin* projection of the
 * same `lib/` functions the web pages call. No business logic lives in them.
 * A setup scored one way on the web and another way on the phone would be a
 * bug nobody could find, so there is exactly one implementation of each.
 *
 * ## Why the session travels as a cookie, not a bearer token
 *
 * Everything under `lib/` resolves the acting user through
 * `session.currentUserId()`, which reads the `mnha_session` cookie — including
 * `broker.ts`, where that lookup is the per-user data boundary. A bearer token
 * would be more idiomatic for a mobile client, but it would be invisible to
 * all of that code, so the phone would either see nothing or, far worse, fall
 * through to the house account.
 *
 * So the Flutter client sends the same signed token the browser holds, as a
 * Cookie header. The token is minted by /api/mobile/login and is identical to
 * the browser's: same HMAC, same 8-hour expiry, same verification path.
 */

export type Role = "owner" | "admin" | "member";

export interface Caller {
  userId: string;
  role: Role;
}

export function roleOf(userId: string): Role {
  if (userId === ADMIN_ID) return "admin";
  if (userId === OWNER_ID) return "owner";
  return "member";
}

/** JSON with no caching — every one of these is per-user, live, or both. */
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export function fail(message: string, status = 400): NextResponse {
  return json({ error: message }, status);
}

/**
 * The signed-in caller, or null.
 *
 * The proxy already rejects an unauthenticated request to anything under
 * /api/mobile/ except the login route, so in practice this is belt and
 * braces. It is here anyway because "the proxy will have handled it" is
 * exactly the assumption that turns a routing change into a data leak.
 */
export async function caller(): Promise<Caller | null> {
  const jar = await cookies();
  const info = await sessionInfo(jar.get(SESSION_COOKIE)?.value);
  if (!info) return null;

  // A member account that no longer exists counts as signed out at once, on
  // every device, even while its cookie is still valid — the same rule
  // `session.currentUserId()` applies on the web.
  //
  // Verifying the token's signature is NOT sufficient on its own: the token
  // stays cryptographically valid for its full eight hours, so without this
  // a deleted account could keep reading its old data from a phone after the
  // website had already cut it off. Reserved ids (owner, admin) are env
  // logins with no user record, so they skip the lookup.
  if (!isReservedId(info.userId) && !(await findById(info.userId))) return null;

  return { userId: info.userId, role: roleOf(info.userId) };
}

/**
 * Wraps a handler so it only runs for a signed-in caller, and so a thrown
 * error becomes a 500 with a message instead of an unhandled rejection.
 *
 * Upstream failures are deliberately NOT swallowed into empty results here.
 * On the web a broker blip leaves a screen visibly empty; on a phone the user
 * is more likely to act on what they see, so a failure should say it failed
 * rather than look like a flat, calm, empty account.
 */
export async function guarded(
  handler: (c: Caller) => Promise<NextResponse>,
): Promise<NextResponse> {
  const c = await caller();
  if (!c) return fail("Not signed in.", 401);
  try {
    return await handler(c);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return fail(message, 500);
  }
}
