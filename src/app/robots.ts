import type { MetadataRoute } from "next";

/**
 * Nothing here is public. Every route sits behind a sign-in, so there is
 * nothing for a crawler to index, and a financial sign-in page appearing in
 * search results is the shape abuse classifiers are built to catch.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
