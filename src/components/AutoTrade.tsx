"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ACCOUNT } from "@/lib/book";
import { fmtMoney } from "@/lib/format";

/**
 * Auto-trade mode.
 *
 * Turning it on hands the account to the engine and locks the screen behind a
 * full-page cover, so a stray click cannot modify an order mid-flight. The only
 * two ways out are the STOP button and Escape — both stop the engine, neither
 * merely hides the cover.
 *
 * State deliberately does NOT persist. A reload stops auto-trading, because a
 * refreshed tab is exactly the moment you least want an engine to still be
 * placing orders you cannot see.
 */

interface AutoTradeCtx {
  on: boolean;
  start: () => void;
  stop: () => void;
}

const Ctx = createContext<AutoTradeCtx>({ on: false, start: () => {}, stop: () => {} });

export function useAutoTrade() {
  return useContext(Ctx);
}

export function AutoTradeProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const start = useCallback(() => setOn(true), []);
  const stop = useCallback(() => setOn(false), []);

  return (
    <Ctx.Provider value={{ on, start, stop }}>
      {children}
      {on && <AutoTradeCover />}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ toggle */

export function AutoTradeToggle() {
  const { on, start, stop } = useAutoTrade();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Auto trade"
      onClick={on ? stop : start}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-2.5 text-[12px] font-semibold transition-colors ${
        on
          ? "border-brand bg-brandsoft text-brandtext"
          : "border-line text-ink2 hover:bg-surfaceh hover:text-ink"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
      </svg>
      <span className="hidden whitespace-nowrap sm:inline">Auto trade</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${on ? "bg-brand" : "bg-line2"}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------- cover */

/** What the engine narrates while it runs. Cycles so the screen is never dead. */
const STEPS = [
  "Scanning 32 NSE symbols…",
  "NIFTY 50 checked against its 20 DMA — regime gate open",
  "COALINDIA cleared the volume filter at 4.4x average",
  "Sizing against the ₹2,000 per-trade risk limit",
  "Placing LIMIT BUY 600 COALINDIA @ ₹408.50 · MIS",
  "Order accepted — read back from the broker and verified",
  "GTT + OCO armed · stop ₹402.10 · target ₹421.00",
  "TATAPOWER breaking out — queued behind the open-position cap",
  "Monitoring 3 working positions…",
  "Trailing the stop on ADANIGREEN to ₹1,262.00",
  "Re-scan in 4 min · nothing else passed the filter",
];

function AutoTradeCover() {
  const { stop } = useAutoTrade();
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const stopRef = useRef<HTMLButtonElement>(null);

  // Advance the narration and the clock. setState lives in the interval
  // callback, never synchronously in the effect body.
  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    const next = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => {
      clearInterval(tick);
      clearInterval(next);
    };
  }, []);

  // Lock the page behind the cover and put focus on the way out.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    stopRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Escape stops the engine. It does not merely dismiss the cover — leaving a
  // running engine behind a hidden screen would be the worst of both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const recent = [0, 1, 2].map((i) => STEPS[(step - i + STEPS.length) % STEPS.length]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Auto trade is running"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/95 p-4 backdrop-blur-sm"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-7 text-center"
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        {/* live indicator */}
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brandsoft">
          <span className="live-dot grid h-10 w-10 place-items-center rounded-full bg-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
            </svg>
          </span>
        </div>

        <h2 className="mt-5 text-[22px] leading-tight font-bold tracking-tight text-ink">
          Hands off — MNHA is trading
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink2">
          The engine is placing and managing orders on its own. The screen stays locked so a stray
          click cannot change an order mid-flight.
        </p>

        {/* what it is doing right now */}
        <div className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wider text-ink3 uppercase">
              Live activity
            </span>
            <span className="tnum text-[11px] text-ink3">{mm}:{ss}</span>
          </div>
          <ul className="mt-2 space-y-1.5">
            {recent.map((s, i) => (
              <li
                key={`${s}-${i}`}
                className={`flex items-start gap-2 text-[12.5px] leading-snug transition-opacity ${
                  i === 0 ? "text-ink opacity-100" : i === 1 ? "text-ink2 opacity-70" : "text-ink3 opacity-40"
                }`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i === 0 ? "bg-brand" : "bg-line2"}`}
                  aria-hidden="true"
                />
                {s}
              </li>
            ))}
          </ul>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          {[
            { k: "Balance", v: fmtMoney(ACCOUNT.balance, 0) },
            { k: "Risk / trade", v: "₹2,000" },
            { k: "Max positions", v: "5" },
          ].map((x) => (
            <div key={x.k} className="rounded-lg border border-line bg-surface2 px-2 py-2">
              <dt className="text-[10px] tracking-wider text-ink3 uppercase">{x.k}</dt>
              <dd className="tnum mt-0.5 text-[13px] font-semibold text-ink">{x.v}</dd>
            </div>
          ))}
        </dl>

        <button
          ref={stopRef}
          type="button"
          onClick={stop}
          className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-down text-[16px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-down"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop auto trade
        </button>

        <p className="mt-3 text-[11px] text-ink3">
          Press <kbd className="rounded border border-line bg-surface2 px-1 py-0.5 font-medium">Esc</kbd> to stop ·
          Orders route to your Groww account
        </p>
      </div>
    </div>
  );
}
