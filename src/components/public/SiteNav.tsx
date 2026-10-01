import Link from "next/link";
import { Wordmark } from "./Brand";
import MobileMenu from "./MobileMenu";

const LINKS: [string, string][] = [
  ["/#path", "How it works"],
  ["/#desk", "The desk"],
  ["/#try", "Risk maths"],
  ["/#membership", "Membership"],
  ["/#faq", "FAQ"],
];

/** Sticky editorial nav for every public page. A server component; only the phone menu hydrates. */
export default function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-pub-hair bg-pub-ink/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-[74rem] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href="/" aria-label="MNHA Financials — home" className="shrink-0">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-7 text-[15px] font-medium text-pub-cream lg:flex">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="transition-opacity hover:opacity-70">
              {label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5 lg:ml-6">
          <Link
            href="/login"
            className="hidden border border-pub-cream px-4 py-2 text-[15px] font-medium text-pub-cream transition-colors hover:bg-pub-cream hover:text-pub-ink sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex bg-pub-cream px-3 py-2 text-[14px] font-medium whitespace-nowrap text-pub-ink transition-colors hover:bg-white sm:px-4 sm:text-[15px]"
          >
            Get started
          </Link>

          <MobileMenu links={LINKS} />
        </div>
      </div>
    </header>
  );
}
