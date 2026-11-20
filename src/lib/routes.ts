/**
 * Who can open what. The scanner, the terminal and the demo board stay with the
 * owner; everyone's home is the Home page (/ai). The owner's account keeps the
 * full desk. Shared by the proxy (edge) and server pages, so it has
 * no server-only imports.
 */

/** Sections only the owner's account may open. */
export const OWNER_ONLY = ["/stocks/scanner", "/terminal", "/linked-accounts"];

/** The admin console — only the admin login opens it, not even the owner's account. */
export const ADMIN_ONLY = ["/admin"];

/** All the admin login may open: its console, the gated KYC and consent files
 *  that the console links to, and the console's own mobile endpoint.
 *
 *  /api/mobile/admin is listed here but deliberately NOT in ADMIN_ONLY above.
 *  Being here is what lets the admin login reach it at all. Keeping it out of
 *  ADMIN_ONLY means a member who calls it is not redirected to an HTML page —
 *  the route answers with its own 403, which a JSON client can actually
 *  report. The route re-checks the role itself, so the boundary does not
 *  depend on this list. */
const ADMIN_MAY_OPEN = [
  ...ADMIN_ONLY,
  "/api/kyc/file",
  "/api/consent/media",
  "/api/mobile/admin",
  // The mobile client asks "who am I" on every launch, for every role. Without
  // this the admin's own session answers 307, the client reads that as an
  // expired session, and signing in as admin bounces straight back to the
  // login screen. The route returns only the admin's identity and the market
  // clock — it makes no broker call for a reserved id.
  "/api/mobile/me",
];

export const OWNER_HOME = "/ai";
export const MEMBER_HOME = "/ai";
export const ADMIN_HOME = "/admin";

const under = (pathname: string, list: string[]) => list.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function isOwnerOnly(pathname: string): boolean {
  return under(pathname, OWNER_ONLY);
}

export function isAdminOnly(pathname: string): boolean {
  return under(pathname, ADMIN_ONLY);
}

export function adminMayOpen(pathname: string): boolean {
  return under(pathname, ADMIN_MAY_OPEN);
}
