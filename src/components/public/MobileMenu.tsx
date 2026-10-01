"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const shut = (d: HTMLDetailsElement | null) => {
  if (d) d.open = false;
};

/**
 * The phone menu. Still a <details>, so it opens before hydration; once
 * hydrated it also closes when a link is followed (in-page anchors do not
 * remount the nav), on Escape, and on a tap outside it.
 */
export default function MobileMenu({ links }: { links: [string, string][] }) {
  // The DOM owns `open` (so a tap before hydration still counts); state only
  // mirrors it, to listen for Escape / outside taps while it is open.
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      shut(ref.current);
      summaryRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) shut(ref.current);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const close = () => shut(ref.current);

  return (
    <details ref={ref} onToggle={(e) => setOpen(e.currentTarget.open)} className="group relative lg:hidden">
      <summary
        ref={summaryRef}
        aria-label="Menu"
        className="grid h-10 w-10 cursor-pointer place-items-center border border-pub-hair text-pub-cream"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path className="group-open:hidden" d="M3 7h18M3 12h18M3 17h18" />
          <path className="hidden group-open:block" d="M5 5l14 14M19 5 5 19" />
        </svg>
      </summary>
      <nav aria-label="Primary (mobile)" className="absolute top-12 right-0 w-64 border border-pub-hair bg-pub-card p-2">
        {links.map(([href, label]) => (
          <Link key={href} href={href} onClick={close} className="block px-3 py-2.5 text-[15px] text-pub-cream hover:bg-pub-ink2">
            {label}
          </Link>
        ))}
        <Link
          href="/login"
          onClick={close}
          className="mt-1 block border-t border-pub-hair px-3 py-2.5 text-[15px] text-pub-cream hover:bg-pub-ink2"
        >
          Sign in
        </Link>
      </nav>
    </details>
  );
}
