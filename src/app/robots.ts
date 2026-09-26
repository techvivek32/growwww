import type { MetadataRoute } from "next";
import { SITE_URL } from "./layout";

/**
 * Crawlers may index the public marketing and legal pages; everything behind
 * the sign-in (the terminal and account data) is disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/signup", "/login", "/legal/"],
      disallow: [
        "/stocks/", "/fno/", "/portfolio/", "/trade", "/terminal",
        "/broker", "/settings", "/indices", "/connect-broker", "/api/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
