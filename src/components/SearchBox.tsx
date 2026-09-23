"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SymbolChip } from "./ui";

/**
 * Instrument search: every NSE equity plus the indices, straight from the
 * instrument master. Ctrl/Cmd-K focuses it; arrows move, Enter opens the
 * detail page. Debounced so a fast typist costs one request, not eight.
 */

interface Hit {
  symbol: string;
  name: string;
  kind: "index" | "stock";
}

export default function SearchBox() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Ctrl/Cmd-K focuses the box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced fetch.
  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setHits([]);
        setOpen(false);
        return;
      }
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { hits: Hit[] };
        setHits(body.hits);
        setActive(0);
        setOpen(true);
      } catch {
        /* type on */
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = (hit: Hit) => {
    setOpen(false);
    setQ("");
    router.push(`/stock/${hit.symbol}`);
  };

  return (
    <div ref={wrapRef} className="relative w-full max-w-[400px]">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface2 px-3 focus-within:border-brand">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink3">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(hits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Search NSE stocks, indices…"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink3"
          aria-label="Search instruments"
        />
        <kbd className="hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink3 xl:block">
          Ctrl K
        </kbd>
      </label>

      {open && hits.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-11 right-0 left-0 z-50 overflow-hidden rounded-xl border border-line bg-surface py-1"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.symbol}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  i === active ? "bg-surfaceh" : ""
                }`}
              >
                <SymbolChip symbol={h.symbol} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{h.symbol}</span>
                  <span className="block truncate text-[11.5px] text-ink3">{h.name}</span>
                </span>
                <span className="shrink-0 text-[10.5px] font-semibold tracking-wide text-ink3 uppercase">
                  {h.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
