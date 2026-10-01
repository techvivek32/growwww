import "server-only";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/session";
import { OWNER_ID } from "@/lib/auth";
import { MEMBER_HOME, OWNER_HOME } from "@/lib/routes";

/** True only for the owner's (house) account — the one with the full desk. */
export async function isOwnerSession(): Promise<boolean> {
  return (await currentUserId()) === OWNER_ID;
}

/** Where a signed-in account lands. */
export function homeFor(userId: string): string {
  return userId === OWNER_ID ? OWNER_HOME : MEMBER_HOME;
}

/** Page guard for owner-only sections (the proxy checks too — defence in depth). */
export async function requireOwnerPage(): Promise<void> {
  if (!(await isOwnerSession())) redirect(MEMBER_HOME);
}
