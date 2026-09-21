import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";

/**
 * Gate the whole terminal behind a valid session. The matcher below excludes
 * /login and Next's own asset routes; everything else needs a cookie whose
 * HMAC verifies and whose expiry has not passed.
 *
 * This is the `proxy` file convention — `middleware` is deprecated in Next 16.
 */
export async function proxy(req: NextRequest) {
  const ok = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  const res = NextResponse.redirect(url);
  // Clear a stale or tampered cookie rather than leaving it to be retried.
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: [
    // robots.txt stays reachable — redirecting a crawler to a sign-in page
    // teaches it nothing and reads worse than an honest Disallow.
    "/((?!login|robots.txt|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
