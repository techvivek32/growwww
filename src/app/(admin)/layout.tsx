import Link from "next/link";
import { redirect } from "next/navigation";
import { ADMIN_ID } from "@/lib/auth";
import { currentUserId } from "@/lib/session";
import { homeFor } from "@/lib/access";
import { logout } from "@/app/login/actions";
import ThemeToggle from "@/components/ThemeToggle";
import { LogoMark, Wordmark } from "@/components/public/Brand";

export const dynamic = "force-dynamic";

/**
 * The admin console's own chrome. The admin login is not a trading account —
 * no broker, no markets, no order entry — so it gets none of the terminal's
 * nav, and the terminal's accounts never see this one.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid !== ADMIN_ID) redirect(homeFor(uid));

  return (
    <>
      <header className="app-header sticky top-0 z-40 border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-3 px-4 lg:px-6">
          <Link href="/admin" className="flex shrink-0 items-center text-ink" aria-label="Admin console home">
            <span className="sm:hidden">
              <LogoMark tone="current" />
            </span>
            <span className="hidden sm:inline-flex">
              <Wordmark tone="current" />
            </span>
          </Link>
          <span className="border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.08em] text-ink2 uppercase">
            Admin console
          </span>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <form action={logout}>
              <button
                type="submit"
                className="flex h-9 items-center gap-2 border border-line2 px-3 text-[12.5px] font-medium text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1360px] px-4 py-6 lg:px-6 lg:py-8">{children}</main>
    </>
  );
}
