/**
 * The public site address: NEXT_PUBLIC_SITE_URL when it is a valid http(s) URL,
 * otherwise the production domain. An empty value (as .env.example once shipped
 * it) or a typo must never break every page through `new URL()`, nor the QR and
 * email links built from it.
 */
const FALLBACK = "https://mnhafinancials.com";

export function siteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" || u.protocol === "http:") return raw;
  } catch {
    /* empty, or not a URL */
  }
  return FALLBACK;
}
