/**
 * Small pieces of the sign-up flow shared by the server action and the page.
 *
 * They live here, not in the action file: a "use server" module may export
 * async functions only, so a constant and a formatter cannot sit beside the
 * actions that use them.
 */

/** Holds the pending sign-up while its emailed code is outstanding. */
export const SIGNUP_COOKIE = "mnha_signup";

/** Show enough of the address to recognise, not enough to read out. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}
