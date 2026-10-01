import Link from "next/link";
import type { ReactNode } from "react";
import { pubFonts } from "@/components/public/fonts";
import SiteNav from "@/components/public/SiteNav";
import SiteFooter from "@/components/public/SiteFooter";

/**
 * The chrome for public pages that are not the landing itself — legal, contact
 * and the like. Same editorial nav and footer as the landing, so the public
 * surface reads as one site, without pulling in the authed terminal chrome.
 */
export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className={`pub ${pubFonts} min-h-dvh`}>
      <SiteNav />
      <main className="mx-auto w-full max-w-[48rem] px-4 py-16 sm:px-6 sm:py-24">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Shared article styling for the legal prose. */
export function LegalArticle({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article>
      <Link
        href="/"
        className="text-[14px] font-medium text-pub-cream underline decoration-pub-accent decoration-2 underline-offset-[6px] hover:opacity-80"
      >
        ← Back to home
      </Link>
      <h1 className="pub-display mt-10 text-[clamp(2.8rem,6vw,4.4rem)] leading-[0.98] text-pub-cream">{title}</h1>
      <p className="mt-5 border-b border-pub-cream pb-5 font-plex text-[11px] tracking-[0.12em] text-pub-muted uppercase">
        Last updated · {updated}
      </p>
      <div className="legal mt-10 space-y-6 text-[15.5px] leading-[1.7] text-pub-muted">{children}</div>
    </article>
  );
}
