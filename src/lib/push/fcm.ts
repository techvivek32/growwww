import "server-only";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dropTokens } from "./devices";

/**
 * Firebase Cloud Messaging, HTTP v1, spoken directly over fetch.
 *
 * No firebase-admin dependency: the whole conversation is a signed JWT traded
 * for an access token, then one POST per device. Pulling in the Admin SDK for
 * that would add a large transitive tree to a server whose other outbound
 * calls are all plain fetch, and it would want its own credential handling on
 * top of the one below.
 *
 * ## Unconfigured is a supported state, not an error
 *
 * If no service account is set, `send()` quietly does nothing and says so in
 * its result. That is deliberate. Push is an extra delivery channel on top of
 * the in-app feed, never the record itself — the notification is already
 * safely written to `notifications.json` before anything here is called. A
 * missing Firebase key must therefore degrade to "no push", never to a failed
 * settlement or an order notice that was not recorded.
 */

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping should land in the app, e.g. "orders" or "account". */
  route: string;
  /** The notification's own id, so the app can mark exactly it as read. */
  id: string;
  kind: string;
  /** Order and broker failures interrupt; the rest can wait for a glance. */
  urgent?: boolean;
}

export interface SendResult {
  configured: boolean;
  sent: number;
  failed: number;
  pruned: number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Must match the channel the Flutter app creates, or Android silently drops
 *  the notification on API 26+. Both sides read this same literal. */
export const CHANNEL_ID = "mnha_alerts";

let cached: ServiceAccount | null | undefined;

/** Read the service account once. `undefined` means "not looked yet",
 *  `null` means "looked, and there isn't one". */
async function account(): Promise<ServiceAccount | null> {
  if (cached !== undefined) return cached;
  const inline = process.env.FCM_SERVICE_ACCOUNT?.trim();
  const file = process.env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  try {
    const raw = inline ? inline : file ? await readFile(file, "utf8") : null;
    if (!raw) {
      cached = null;
      return null;
    }
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      console.error("[push] service account is missing project_id/client_email/private_key");
      cached = null;
      return null;
    }
    // A key pasted into an env var usually arrives with literal \n sequences
    // rather than real newlines, and PEM parsing fails on it with a message
    // that says nothing useful about the cause.
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    cached = parsed;
    return cached;
  } catch (e) {
    console.error("[push] could not read the service account:", e instanceof Error ? e.message : e);
    cached = null;
    return null;
  }
}

export async function isConfigured(): Promise<boolean> {
  return (await account()) !== null;
}

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let token: { value: string; expiresAt: number } | null = null;

/**
 * A Google access token, cached until shortly before it expires.
 *
 * Re-minting on every notification would add a round trip to each one and
 * would rate-limit the token endpoint on a busy settlement run.
 */
async function accessToken(sa: ServiceAccount): Promise<string | null> {
  if (token && Date.now() < token.expiresAt) return token.value;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  let signature: string;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    signature = b64url(signer.sign(sa.private_key));
  } catch (e) {
    console.error("[push] could not sign the auth JWT:", e instanceof Error ? e.message : e);
    return null;
  }

  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claim}.${signature}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error(`[push] token endpoint answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    // Refresh a minute early rather than racing the expiry.
    token = { value: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
    return token.value;
  } catch (e) {
    console.error("[push] token request failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** FCM says a token is permanently dead with these. Anything else (a 503, a
 *  timeout) is transient and must NOT delete a working device. */
function isDeadToken(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  return /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND|SENDER_ID_MISMATCH/i.test(body);
}

async function sendOne(
  projectId: string,
  bearer: string,
  deviceToken: string,
  m: PushMessage,
): Promise<"ok" | "dead" | "failed"> {
  const payload = {
    message: {
      token: deviceToken,
      // `notification` is what Android draws in the tray when the app is in
      // the background or killed. `data` is what the app reads on tap. Both
      // are needed: data alone never surfaces a killed app's notification.
      notification: { title: m.title, body: m.body },
      data: { route: m.route, id: m.id, kind: m.kind },
      android: {
        priority: m.urgent ? "HIGH" : "NORMAL",
        notification: {
          channel_id: CHANNEL_ID,
          // Collapses to one tray entry per notification id, so an engine
          // retry cannot stack three copies of the same order notice.
          tag: m.id,
          click_action: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
    },
  };

  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return "ok";
    const text = (await r.text()).slice(0, 300);
    if (isDeadToken(r.status, text)) return "dead";
    console.error(`[push] FCM answered ${r.status}: ${text}`);
    return "failed";
  } catch (e) {
    console.error("[push] send failed:", e instanceof Error ? e.message : e);
    return "failed";
  }
}

/**
 * Deliver one message to a set of devices.
 *
 * HTTP v1 has no multicast — the Admin SDK's "multicast" is a client-side
 * loop — so this loops too, a few at a time so a user with several devices
 * does not serialise behind ten sequential round trips.
 */
export async function send(tokens: string[], m: PushMessage): Promise<SendResult> {
  const sa = await account();
  if (!sa) return { configured: false, sent: 0, failed: 0, pruned: 0 };
  if (tokens.length === 0) return { configured: true, sent: 0, failed: 0, pruned: 0 };

  const bearer = await accessToken(sa);
  if (!bearer) return { configured: true, sent: 0, failed: tokens.length, pruned: 0 };

  const dead: string[] = [];
  let sent = 0;
  let failed = 0;

  const BATCH = 5;
  for (let i = 0; i < tokens.length; i += BATCH) {
    const slice = tokens.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((t) => sendOne(sa.project_id, bearer, t, m)),
    );
    results.forEach((res, n) => {
      if (res === "ok") sent++;
      else if (res === "dead") dead.push(slice[n]);
      else failed++;
    });
  }

  if (dead.length > 0) {
    await dropTokens(dead).catch((e) =>
      console.error("[push] could not prune dead tokens:", e instanceof Error ? e.message : e),
    );
  }
  return { configured: true, sent, failed, pruned: dead.length };
}
