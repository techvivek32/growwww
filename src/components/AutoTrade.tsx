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

/**
 * Auto-trade arm switch.
 *
 * Arming locks the screen behind a full cover with a STOP control. The cover
 * is explicit about the current truth: order placement is NOT enabled in this
 * build, so arming places nothing — the lock exists so the surface is ready
 * for the day an engine is wired in, without pretending one is running now.
 *
 * State deliberately does NOT persist across a reload.
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
      className={`flex h-8 shrink-0 items-center gap-2 border px-2.5 font-mono text-[11px] tracking-[0.04em] uppercase transition-colors ${
        on
          ? "border-mark bg-brandsoft text-brandtext"
          : "border-line text-ink2 hover:bg-surfaceh hover:text-ink"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
      </svg>
      <span className="hidden whitespace-nowrap sm:inline">Auto trade</span>
      <span className={`relative h-3.5 w-6 shrink-0 transition-colors ${on ? "bg-mark" : "bg-line2"}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-2.5 w-2.5 bg-surface transition-all ${on ? "left-3" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------- cover */

function AutoTradeCover() {
  const { stop } = useAutoTrade();
  const [seconds, setSeconds] = useState(0);
  const stopRef = useRef<HTMLButtonElement>(null);

  // A real clock: time since the switch was armed, nothing more.
  useEffect(() => {
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
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

  // Escape disarms — it does not merely dismiss the cover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Auto trade is armed"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/95 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg border border-line2 bg-surface p-7 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brandsoft">
          <span className="live-dot grid h-10 w-10 place-items-center rounded-full bg-mark text-onbrand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
            </svg>
          </span>
        </div>

        <h2 className="pub-display mt-5 text-[32px] leading-tight text-ink">
          Auto trade is <em>armed</em>
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-ink2">
          Order placement is <strong className="font-semibold text-ink">not enabled</strong> in this
          build, so no orders will be placed. The screen stays locked while armed so nothing changes
          under your hands.
        </p>

        <p className="tnum mt-5 font-mono text-[11px] tracking-[0.08em] text-ink3 uppercase">armed {mm}:{ss}</p>

        <button
          ref={stopRef}
          type="button"
          onClick={stop}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2 bg-down text-[16px] font-semibold text-onbrand transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-down"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" />
          </svg>
          Stop
        </button>

        <p className="mt-3 text-[11px] text-ink3">
          Press <kbd className="border border-line bg-surface2 px-1 py-0.5 font-mono font-medium">Esc</kbd> to stop
        </p>
      </div>
    </div>
  );
}
