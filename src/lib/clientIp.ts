import "server-only";

/**
 * The visitor's IP address as nginx saw it.
 *
 * The app listens on 127.0.0.1 only, so every request comes through nginx,
 * which sets X-Real-IP (and X-Forwarded-For) to the connecting address and
 * overwrites whatever the client sent. Never trust the FIRST X-Forwarded-For
 * entry: a client can put anything there, which would let it dodge the
 * sign-in rate limits and forge the IP stored with a signed agreement. If only
 * X-Forwarded-For is present, the LAST entry is the one the proxy added.
 */
export function clientIp(h: { get(name: string): string | null }, fallback = "local"): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const last = h.get("x-forwarded-for")?.split(",").pop()?.trim();
  return last || fallback;
}
