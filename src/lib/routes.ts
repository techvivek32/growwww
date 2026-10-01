/**
 * Who can open what. Member accounts are view-only: no signals or alerts, no
 * manual order entry — their home is the MNHA AI page. The owner's account
 * keeps the full desk. Shared by the proxy (edge) and server pages, so it has
 * no server-only imports.
 */

/** Sections only the owner's account may open. */
export const OWNER_ONLY = ["/stocks/alerts", "/fno/alerts", "/stocks/scanner", "/terminal", "/linked-accounts", "/admin"];

export const OWNER_HOME = "/stocks/alerts";
export const MEMBER_HOME = "/ai";

export function isOwnerOnly(pathname: string): boolean {
  return OWNER_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
