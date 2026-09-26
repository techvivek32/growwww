import type { NextConfig } from "next";

/**
 * Security headers on every response. These are the safe, high-value set that
 * does not need per-request nonces:
 *  - HSTS pins HTTPS for a year (the site is TLS-only behind nginx);
 *  - X-Frame-Options + frame-ancestors stop the terminal being framed
 *    (clickjacking a live trading screen is exactly the attack to deny);
 *  - nosniff, Referrer-Policy and a tight Permissions-Policy close the usual
 *    small holes.
 * A full script-src CSP is intentionally left for a nonce-aware pass rather
 * than shipping one that quietly breaks Next's inline runtime.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
