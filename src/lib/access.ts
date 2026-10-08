import "server-only";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { ADMIN_ID, OWNER_ID } from "@/lib/auth";
import { ADMIN_HOME, MEMBER_HOME, OWNER_HOME } from "@/lib/routes";
import { mayTrade } from "@/lib/trading";

/** True only for the owner's (house) account — the one with the full desk. */
export async function isOwnerSession(): Promise<boolean> {
  return (await currentUserId()) === OWNER_ID;
}

/** May the signed-in account place orders? The owner always; a member once the
 *  static IP on their own Groww key is the address our orders are sent from. */
export async function canTradeSession(): Promise<boolean> {
  return mayTrade(await currentUserId());
}

/** True only for the admin console login. */
export async function isAdminSession(): Promise<boolean> {
  return (await currentUserId()) === ADMIN_ID;
}

/** Where a signed-in account lands. */
export function homeFor(userId: string): string {
  if (userId === ADMIN_ID) return ADMIN_HOME;
  return userId === OWNER_ID ? OWNER_HOME : MEMBER_HOME;
}

/** Page guard for owner-only sections (the proxy checks too — defence in depth). */
export async function requireOwnerPage(): Promise<void> {
  if (!(await isOwnerSession())) redirect(MEMBER_HOME);
}

/** Page guard for the admin console (the proxy checks too — defence in depth). */
export async function requireAdminPage(): Promise<void> {
  const uid = await currentUserId();
  if (uid !== ADMIN_ID) redirect(uid ? homeFor(uid) : "/login");
}
