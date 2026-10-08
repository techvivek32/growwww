import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ID, OWNER_ID, SESSION_COOKIE, sessionUserId } from "@/lib/auth";
import { ADMIN_HOME, MEMBER_HOME, OWNER_HOME, adminMayOpen, isAdminOnly, isOwnerOnly } from "@/lib/routes";

/**
 * Gate the whole terminal behind a valid session. The matcher below excludes
 * /login and Next's own asset routes; everything else needs a cookie whose
 * HMAC verifies and whose expiry has not passed.
 *
 * This is the `proxy` file convention — `middleware` is deprecated in Next 16.
 */
export async function proxy(req: NextRequest) {
  const uid = await sessionUserId(req.cookies.get(SESSION_COOKIE)?.value);
  if (uid) {
    const path = req.nextUrl.pathname;
    // Hand the path to server layouts (they cannot read it otherwise); always
    // overwritten here, so a client cannot supply its own.
    const pass = () => {
      const h = new Headers(req.headers);
      h.set("x-mnha-path", path);
      return NextResponse.next({ request: { headers: h } });
    };
    const sendTo = (pathname: string) => {
      const home = req.nextUrl.clone();
      home.pathname = pathname;
      home.search = "";
      return NextResponse.redirect(home);
    };
    // The admin login is a console, not a trading account: it opens the admin
    // pages and nothing else.
    if (uid === ADMIN_ID) return adminMayOpen(path) ? pass() : sendTo(ADMIN_HOME);
    // Nobody else opens the console — the owner's trading account included.
    if (isAdminOnly(path)) return sendTo(uid === OWNER_ID ? OWNER_HOME : MEMBER_HOME);
    // Owner-only sections send a member home.
    if (uid !== OWNER_ID && isOwnerOnly(path)) return sendTo(MEMBER_HOME);
    return pass();
  }

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
    // Public, ungated routes: the marketing landing ("$" = the root path),
    // the phone identity step under /m/ (authorised by its own one-time token)
    // with the on-device face model it loads from /mediapipe/,
    // sign-in and sign-up, robots, and static assets. Everything else needs a
    // valid session. Redirecting a crawler to a sign-in page teaches it
    // nothing and reads worse than an honest Disallow.
    "/((?!login|signup|legal|m/|mediapipe/|robots.txt|sitemap.xml|_next/static|_next/image|favicon.ico|$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
