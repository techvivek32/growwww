"use client";

import { useEffect, useRef, useState } from "react";
import { SymbolChip } from "./ui";

/**
 * The "Add stocks" box on a watchlist: search the instrument master, pick a
 * hit, and it posts straight into the list via the server action wired to
 * the surrounding form.
 */

interface Hit {
  symbol: string;
  name: string;
  kind: "index" | "stock";
}

export default function AddStockBox({
  listId,
  action,
}: {
  listId: string;
  action: (form: FormData) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

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
        setOpen(true);
      } catch {
        /* type on */
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (symbol: string) => {
    setBusy(true);
    setOpen(false);
    setQ("");
    try {
      const form = new FormData();
      form.set("id", listId);
      form.set("symbol", symbol);
      await action(form);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative w-full max-w-[300px]">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface2 px-3 focus-within:border-brand">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-ink3">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          placeholder={busy ? "Adding…" : "Add stocks"}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
          aria-label="Add a stock to this watchlist"
        />
      </label>

      {open && hits.length > 0 && (
        <ul
          className="absolute top-11 right-0 left-0 z-50 overflow-hidden rounded-xl border border-line bg-surface py-1"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {hits.map((h) => (
            <li key={`${h.kind}-${h.symbol}`}>
              <button
                type="button"
                onClick={() => void add(h.symbol)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surfaceh"
              >
                <SymbolChip symbol={h.symbol} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{h.symbol}</span>
                  <span className="block truncate text-[11px] text-ink3">{h.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
