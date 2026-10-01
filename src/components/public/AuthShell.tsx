import Link from "next/link";
import type { ReactNode } from "react";
import { pubFonts } from "./fonts";
import { Wordmark } from "./Brand";
import WaveArt from "./WaveArt";

/**
 * Editorial shell for sign-in, sign-up and the onboarding steps: the form on
 * ink, a risograph panel on the right with a paper card showing where the
 * visitor is in the four-step path.
 */

export const STEPS: [string, string, string][] = [
  ["01", "Create your login", "1 min"],
  ["02", "Agreement & acknowledgement", "≈8 min"],
  ["03", "Connect Groww", "≈5 min"],
  ["04", "Your desk", "live"],
];

/** Compact rail for phones, where the art panel is hidden. */
function StepRail({ step }: { step: number }) {
  return (
    <ol className="mb-10 grid grid-cols-4 gap-1.5 lg:hidden" aria-label="Your progress">
      {STEPS.map(([n, label], i) => {
        const state = i + 1 < step ? "done" : i + 1 === step ? "now" : "next";
        return (
          <li key={n} aria-current={state === "now" ? "step" : undefined}>
            <span className={`block h-[3px] ${state === "next" ? "bg-pub-hair" : state === "now" ? "bg-pub-accent" : "bg-pub-cream"}`} />
            <span className={`mt-2 block font-plex text-[10px] tracking-[0.08em] uppercase ${state === "next" ? "text-pub-dim" : "text-pub-cream"}`}>
              {n} <span className="sr-only">{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PathCard({ step }: { step: number }) {
  return (
    <div className="w-full max-w-[21rem] bg-pub-paper p-5 text-pub-ink">
      <div className="flex items-center justify-between border-b border-pub-ink pb-2.5 font-plex text-[10.5px] tracking-[0.08em] text-[#6d685d] uppercase">
        <span>Your path</span>
        <span>
          Step {step} of {STEPS.length}
        </span>
      </div>
      <ol>
        {STEPS.map(([n, label, dur], i) => {
          const state = i + 1 < step ? "done" : i + 1 === step ? "now" : "next";
          return (
            <li
              key={n}
              aria-current={state === "now" ? "step" : undefined}
              className={`grid grid-cols-[2rem_1fr_auto] items-baseline gap-2 border-b border-dashed border-[#d8d2c4] py-2.5 text-[14px] ${
                state === "next" ? "font-normal text-[#6d685d]" : "font-medium"
              }`}
            >
              {/* Status by marker and weight, not colour alone: ✓ done, semibold + underline now, regular weight next. */}
              <span className="font-plex text-[11px]">{state === "done" ? "✓" : n}</span>
              <span className={state === "now" ? "font-semibold underline decoration-pub-accent decoration-2 underline-offset-4" : ""}>
                {label}
                <span className="sr-only">{state === "done" ? " (done)" : state === "now" ? " (current step)" : " (upcoming)"}</span>
              </span>
              <span className="font-plex text-[11px] text-[#6d685d]">{dur}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3.5 font-plex text-[10.5px] leading-relaxed tracking-[0.06em] text-[#6d685d] uppercase">
        We never ask for your Groww password, PIN or OTP
      </p>
    </div>
  );
}

export default function AuthShell({
  step,
  headerRight,
  aside,
  children,
  wide = false,
}: {
  /** 1–4 for the onboarding path; omit on sign-in. */
  step?: number;
  headerRight?: ReactNode;
  /** Replaces the path card on the art panel. */
  aside?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`pub ${pubFonts} min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)]`}>
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-pub-hair px-4 sm:px-8">
          <Link href="/" aria-label="MNHA Financials — home">
            <Wordmark />
          </Link>
          {headerRight}
        </header>
        <main className="flex flex-1 justify-center px-4 py-12 sm:px-8 sm:py-16">
          <div className={`w-full ${wide ? "max-w-[44rem]" : "max-w-[26rem]"}`}>
            {step && <StepRail step={step} />}
            {children}
          </div>
        </main>
      </div>

      <aside className="sticky top-0 hidden h-dvh overflow-hidden lg:block">
        <WaveArt variant="hero" uid="auth" />
        <div className="absolute inset-x-0 bottom-12 flex justify-center px-8">{aside ?? (step ? <PathCard step={step} /> : null)}</div>
      </aside>
    </div>
  );
}

/**
 * Square editorial form field styling shared by the auth forms. `fieldBase`
 * carries no font size so callers can set their own (Tailwind orders
 * same-property utilities itself, so a second text-[…] would not override).
 * The faint border keeps the field edge at ≥3:1 against ink and card.
 */
export const fieldBase =
  "h-12 w-full border border-pub-faint bg-pub-card px-3.5 text-pub-cream outline-none transition-colors placeholder:text-pub-dim focus:border-pub-cream";

export const fieldCls = `${fieldBase} text-[15px]`;

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-2 block text-[11px] font-semibold tracking-[0.12em] text-pub-cream uppercase">{children}</span>;
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-5 border-l-2 border-pub-accent bg-pub-accent/10 px-3.5 py-3 text-[14px] leading-snug text-pub-coral">
      {children}
    </p>
  );
}

export const submitCls =
  "mt-7 flex w-full items-center justify-center gap-2.5 bg-pub-cream py-4 text-[16px] font-medium text-pub-ink transition-colors hover:bg-white disabled:opacity-60";
