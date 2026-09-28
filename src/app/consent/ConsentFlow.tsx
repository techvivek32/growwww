"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { acceptConsent, type ConsentState } from "./actions";

/** Good-faith reading period, in seconds (spec: 120s). Not a legal guarantee. */
const READ_SECONDS = 120;

interface Section { heading: string; body: string }

function Submit({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!enabled || pending}
      className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Recording your consent…" : "Provide consent & sign"}
    </button>
  );
}

export default function ConsentFlow({
  title,
  version,
  sections,
}: {
  title: string;
  version: string;
  sections: Section[];
}) {
  const [state, action] = useActionState<ConsentState, FormData>(acceptConsent, {});
  const [scrolled, setScrolled] = useState(false);
  const [left, setLeft] = useState(READ_SECONDS);
  const [agree, setAgree] = useState(false);
  const [name, setName] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Countdown ticks down to zero, once.
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(t);
  }, [left]);

  const onScroll = () => {
    const el = boxRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolled(true);
  };

  const timerDone = left <= 0;
  const ready = scrolled && timerDone && agree && name.trim().length >= 3;

  return (
    <div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="h-[46vh] overflow-y-auto rounded-xl border border-line bg-surface p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <h2 className="text-[16px] font-bold tracking-tight text-ink">{title}</h2>
        <p className="mt-0.5 text-[12px] text-ink3">Version {version}</p>
        <div className="mt-4 space-y-5">
          {sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-[14px] font-semibold text-ink">{s.heading}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink2">{s.body}</p>
            </section>
          ))}
          <p className="border-t border-line pt-4 text-[12px] text-ink3">— End of agreement —</p>
        </div>
      </div>

      {/* progress cues */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
        <span className={scrolled ? "text-up" : "text-ink3"}>
          {scrolled ? "✓ Read to the end" : "Scroll to the end to continue"}
        </span>
        <span className={timerDone ? "text-up" : "text-ink3"}>
          {timerDone ? "✓ Reading period complete" : `Please take a moment — ${left}s`}
        </span>
      </div>

      <form action={action} className="mt-4">
        <input type="hidden" name="agree" value={agree ? "on" : ""} />

        <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface2 px-3.5 py-3">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            disabled={!scrolled || !timerDone}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--c-brand)] disabled:opacity-40"
          />
          <span className="text-[12.5px] leading-relaxed text-ink2">
            I have read and understood the above terms and conditions, and I agree to them.
          </span>
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-semibold text-ink2">Digital signature — type your full name</span>
          <input
            name="signature"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            autoComplete="name"
            className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-[14px] text-ink outline-none focus:border-brand"
          />
        </label>

        {state.error && (
          <p role="alert" className="mt-3 rounded-lg border border-down/30 bg-downsoft px-3 py-2.5 text-[12.5px] text-down">
            {state.error}
          </p>
        )}

        <Submit enabled={ready} />
        <p className="mt-2 text-[11px] leading-relaxed text-ink3">
          Signing records your name, the exact agreement version you saw, and the date, time, IP and device — as an
          audit trail. The reading timer is a good-faith aid, not a legal guarantee.
        </p>
      </form>
    </div>
  );
}
