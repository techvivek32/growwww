import { listForUser, unreadCount, markAllRead } from "@/lib/notifications";
import { json, guarded } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/** GET /api/mobile/notifications — this user's feed, newest first. */
export async function GET() {
  return guarded(async (c) => {
    const [items, unread] = await Promise.all([
      listForUser(c.userId),
      unreadCount(c.userId),
    ]);
    return json({ items, unread });
  });
}

/**
 * POST /api/mobile/notifications — marks everything read.
 *
 * Scoped to the caller's own id from the verified session, never to an id in
 * the body: accepting one would let any signed-in user clear somebody else's
 * notifications.
 */
export async function POST() {
  return guarded(async (c) => {
    await markAllRead(c.userId);
    return json({ ok: true, unread: 0 });
  });
}
