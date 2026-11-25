import { registerDevice, removeDevice } from "@/lib/push/devices";
import { isConfigured } from "@/lib/push/fcm";
import { json, guarded, fail } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/push — whether the server can actually deliver a push.
 *
 * The app asks before it requests the notification permission. Prompting
 * someone for permission to send alerts the server has no key to send is a
 * good way to get the permission denied permanently, and Android only ever
 * asks once.
 */
export async function GET() {
  return guarded(async () => json({ available: await isConfigured() }));
}

/**
 * POST /api/mobile/push — register or forget this device's FCM token.
 *
 * `{ token, platform?, appVersion?, action?: "register" | "unregister" }`
 *
 * Always scoped to the caller's own id from the verified session, never to an
 * id in the body: accepting one would let any signed-in user point somebody
 * else's notifications at their own phone.
 *
 * Unregister is intentionally NOT restricted to the token's current owner. It
 * runs at sign-out, and the whole point of signing out on a borrowed phone is
 * that it stops receiving things — a token is device-scoped and useless to
 * anyone who is not holding that device, so being able to delete one you are
 * physically in possession of is the correct permission.
 */
export async function POST(req: Request) {
  return guarded(async (c) => {
    let body: { token?: unknown; platform?: unknown; appVersion?: unknown; action?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return fail("Expected a JSON body.");
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    // FCM tokens are long opaque strings. The bound is here so a malformed or
    // hostile body cannot push an arbitrarily large value into the store.
    if (!token || token.length > 4096) return fail("A device token is required.");

    if (body.action === "unregister") {
      await removeDevice(token);
      return json({ ok: true, registered: false });
    }

    const platform = body.platform === "ios" ? "ios" : "android";
    const appVersion =
      typeof body.appVersion === "string" && body.appVersion.length <= 32
        ? body.appVersion
        : undefined;

    await registerDevice(c.userId, token, platform, appVersion);
    return json({ ok: true, registered: true, available: await isConfigured() });
  });
}
