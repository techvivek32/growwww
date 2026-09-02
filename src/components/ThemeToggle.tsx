"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Light is the default because Groww is a light-first product. The choice is
 * remembered per browser; a viewer who never chooses follows their OS.
 *
 * The theme lives on <html> as a class, which makes it external state rather
 * than React state — so it is read through useSyncExternalStore instead of an
 * effect. The pre-paint script in layout.tsx sets that class before first
 * paint, so there is never a flash of the wrong theme.
 */

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = () => document.documentElement.classList.contains("dark");

/** SSR has no DOM; light is the documented default. */
const getServerSnapshot = () => false;

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("mnha-theme", next ? "dark" : "light");
    } catch {
      /* private mode or storage blocked — the toggle still works for this page */
    }
    listeners.forEach((l) => l());
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-9 w-9 place-items-center rounded-full text-ink2 transition-colors hover:bg-surfaceh hover:text-ink"
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
      )}
    </button>
  );
}
