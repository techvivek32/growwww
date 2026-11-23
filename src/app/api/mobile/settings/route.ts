import { NextResponse } from "next/server";
import {
  changePasswordAction,
  disconnectBrokerAction,
  deleteAccountAction,
  setOptionalConsentAction,
} from "@/app/(app)/settings/actions";
import { json, guarded, fail } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/settings — the member's own account controls.
 *
 * Like the admin writes, these call the SAME server actions the website's
 * settings form posts to rather than repeating their logic. Two of them are
 * rights, not conveniences — withdrawing an optional consent and erasing the
 * account — and a second implementation that drifted would mean the phone and
 * the website disagreeing about what a person had actually withdrawn.
 *
 * Each action re-checks the acting user itself through `currentUserId()`, and
 * each refuses while an admin is viewing the account, so nothing here can act
 * on someone else's behalf.
 */

/**
 * `redirect()` reports its outcome by throwing, and two of these actions use
 * it to say what happened: disconnecting sends you to /connect-broker, and a
 * deletion that is refused sends you back with ?delete=active or ?delete=due.
 * Letting that throw escape would turn every one of those answers into a 500,
 * so the target is read out and handed to the app instead.
 */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  // Shape: NEXT_REDIRECT;<kind>;<url>;<status>;
  return digest.split(";")[2] ?? "/";
}

async function run(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    await fn();
    return json({ done: true, next: null });
  } catch (err) {
    const next = redirectTarget(err);
    if (next === null) throw err;
    return json({ done: true, next });
  }
}

function form(pairs: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(pairs)) f.append(k, v);
  return f;
}

export async function POST(req: Request) {
  return guarded(async () => {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return fail("Expected a JSON body.", 400);
    }
    const str = (k: string) => String(body[k] ?? "");

    switch (str("action")) {
      case "change-password": {
        // This one answers in a value rather than a redirect, so its message
        // is passed straight through — "that password is wrong" is the whole
        // point of the call.
        const res = await changePasswordAction(
          {},
          form({
            current: str("current"),
            next: str("next"),
            confirm: str("confirm"),
          }),
        );
        if (res.error) return fail(res.error, 400);
        return json({ done: true, next: null });
      }

      case "disconnect-broker":
        return run(() => disconnectBrokerAction());

      case "delete-account":
        // The action refuses a live membership period or an unpaid invoice by
        // redirecting back with a reason; `next` carries that to the app.
        return run(() => deleteAccountAction());

      case "optional-consent":
        return run(() =>
          setOptionalConsentAction(
            form({ key: str("key"), value: str("value") === "on" ? "on" : "" }),
          ),
        );

      default:
        return fail(`Unknown action "${str("action")}".`, 400);
    }
  });
}
