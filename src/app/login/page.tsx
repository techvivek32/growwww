import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · MNHA Financials",
  description: "Sign in to the MNHA Financials NSE terminal.",
};

const POINTS = [
  "Rule-based NSE setups with entry, target and stop on every one",
  "Live balance, holdings, positions and order book from your Groww account",
  "Real-time index and stock prices from the exchange feed",
];

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Brand side — hidden on phones, where the form is the whole job */}
      <section className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: "linear-gradient(150deg, #00d09c 0%, #00a3ff 100%)" }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 opacity-20"
          style={{
            background:
              "radial-gradient(60% 60% at 80% 10%, #fff 0%, transparent 60%), radial-gradient(50% 50% at 10% 90%, #fff 0%, transparent 60%)",
          }}
          aria-hidden="true"
        />

        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/20 ring-1 ring-white/40">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
            </svg>
          </span>
          <span className="leading-none text-white">
            <span className="block text-[17px] font-bold tracking-tight">MNHA</span>
            <span className="block text-[9px] font-semibold tracking-[0.18em] opacity-80">FINANCIALS</span>
          </span>
        </div>

        <div className="max-w-md text-white">
          <h2 className="text-[30px] leading-[1.15] font-bold tracking-tight">
            Keep your broker.
            <br />
            Upgrade your terminal.
          </h2>
          <ul className="mt-6 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-[14px] leading-snug opacity-90">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                  <path d="m5 12.5 4.5 4.5L19 7" />
                </svg>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <p className="max-w-md text-[11px] leading-relaxed text-white/70">
          MNHA Financials is decision-support tooling, not investment advice. Orders you confirm are
          placed on your own Groww account.
        </p>
      </section>

      {/* Form side */}
      <section className="flex items-center justify-center bg-bg px-5 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span
              className="grid h-9 w-9 place-items-center rounded-full"
              style={{ background: "linear-gradient(135deg, #00d09c 0%, #00a3ff 100%)" }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16.5 9.5 11l3.5 3.5L20 7" />
              </svg>
            </span>
            <span className="leading-none">
              <span className="block text-[16px] font-bold tracking-tight text-ink">MNHA</span>
              <span className="block text-[9px] font-semibold tracking-[0.16em] text-ink3">FINANCIALS</span>
            </span>
          </div>

          <h1 className="text-[24px] leading-tight font-bold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1.5 text-[13.5px] text-ink3">
            Use the account linked to your Groww trading profile.
          </p>

          <LoginForm />

          <p className="mt-8 text-[11px] leading-relaxed text-ink3">
            Sessions last eight hours and are stored in an httpOnly cookie. Closing the browser does
            not place or cancel any order.
          </p>
        </div>
      </section>
    </div>
  );
}
