import type { MetadataRoute } from "next";
import { SITE_URL } from "./layout";

/** Only the public surface belongs in the sitemap. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ["", "/signup", "/login", "/legal/terms", "/legal/privacy", "/legal/risk-disclosure", "/legal/contact"];
  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
