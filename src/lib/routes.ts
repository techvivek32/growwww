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

/** All the admin login may open: its console, plus the gated KYC and consent
 *  files that the console links to. */
const ADMIN_MAY_OPEN = [...ADMIN_ONLY, "/api/kyc/file", "/api/consent/media"];

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
