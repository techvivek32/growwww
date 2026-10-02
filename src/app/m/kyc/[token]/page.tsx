import type { Metadata, Viewport } from "next";
import { handoffUser } from "@/lib/kycHandoff";
import { findById } from "@/lib/users";
import { hasConsented, CONTRACT, type Lang } from "@/lib/consent";
import { pubFonts } from "@/components/public/fonts";
import { Wordmark } from "@/components/public/Brand";
import PhoneCapture from "./PhoneCapture";

export const metadata: Metadata = {
  title: "Verify your identity · MNHA Financials",
  robots: { index: false, follow: false },
  // The token is in the URL: never leak it to another site.
  referrer: "no-referrer",
};
export const viewport: Viewport = { themeColor: "#15140f", width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

const LANGS = new Set<Lang>(["en", "hi", "gu"]);

function mask(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/** The phone side of the identity step — reached by scanning the QR code. */
export default async function PhoneKycPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ l?: string }>;
}) {
  const [{ token }, { l }] = await Promise.all([params, searchParams]);
  const lang: Lang = LANGS.has(l as Lang) ? (l as Lang) : "en";
  const t = CONTRACT[lang].ui;
  const uid = handoffUser(token);
  const user = uid ? await findById(uid) : null;
  const usable = Boolean(uid && user && !(await hasConsented(uid)));

  return (
    <div className={`pub ${pubFonts} min-h-dvh`}>
      <header className="flex h-14 items-center border-b border-pub-hair px-4">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-8">
        <h1 className="pub-display text-[38px] leading-[1.02] text-pub-cream">{t.phoneTitle}</h1>
        {usable && user ? (
          <>
            <p className="mt-2 font-plex text-[11.5px] tracking-[0.06em] text-pub-dim">
              {t.phoneFor} · {mask(user.email)}
            </p>
            <PhoneCapture
              token={token}
              ui={{
                selfie: t.phoneSelfie,
                selfieHint: t.phoneSelfieHint,
                id: t.phoneId,
                idHint: t.phoneIdHint,
                take: t.phoneTake,
                retake: t.phoneRetake,
                done: t.phoneDone,
                expired: t.phoneExpired,
                failed: t.phoneFailed,
                uploading: t.uploading,
              }}
            />
          </>
        ) : (
          <p role="alert" className="mt-6 border-l-2 border-pub-accent pl-3.5 text-[15px] leading-relaxed text-pub-muted">
            {t.phoneExpired}
          </p>
        )}
      </main>
    </div>
  );
}
