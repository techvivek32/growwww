"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Tick {
  book: string;
  leg: string;
  side: number;
  symbol: string;
  entry: number;
  qty: number;
  ltp: number | null;
  running_pnl: number | null;
}
interface Ticks {
  ok: boolean;
  at?: number;
  phase?: string;
  nifty?: number | null;
  items?: Tick[];
  running_total?: number;
  error?: string;
}

const inr = (v: number) => `${v < 0 ? "−" : "+"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const ist = (t: number) => new Date(t * 1000).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * The live strip: every open paper position (Book A, Book B, manual) at the
 * live price, polled every second while the tab is visible. The rest of the
 * page re-renders every 10 s so closed trades and the tables catch up too.
 */
export default function LiveTicks({ every = 1000, pageEvery = 10000 }: { every?: number; pageEvery?: number }) {
  const router = useRouter();
  const [t, setT] = useState<Ticks | null>(null);
  const [stale, setStale] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      if (busy.current || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        const r = await fetch("/api/admin/paper/ticks", { cache: "no-store" });
        const j = (await r.json()) as Ticks;
        if (alive) {
          setT(j);
          setStale(!j.ok);
        }
      } catch {
        if (alive) setStale(true);
      } finally {
        busy.current = false;
      }
    };
    void poll();
    const a = setInterval(poll, every);
    const b = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, pageEvery);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, [router, every, pageEvery]);
  const items = t?.items ?? [];
  // each book apart, with its own running figure: Book A, Book B, Active (auto), Manual (admin) — never one combined number
  const ORDER = ["Book A", "Book B", "Active", "Manual"];
  const books = ORDER.filter((b) => items.some((it) => it.book === b)).concat([...new Set(items.map((it) => it.book))].filter((b) => !ORDER.includes(b)));
  return (
    <div className="rounded-xl border border-line bg-paper2 px-4 py-3">
      <span className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase">
        <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${stale ? "bg-warn" : "bg-up"}`} />
        live · every {Math.round(every / 1000)} s{t?.at ? ` · ${ist(t.at)} IST` : ""}{t?.nifty ? ` · NIFTY ${t.nifty.toLocaleString("en-IN")}` : ""}{t?.phase ? ` · Book A: ${t.phase}` : ""}
      </span>
      {t?.error && <p className="mt-1 text-[12px] text-down">{t.error}</p>}
      {items.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-ink3">No open paper position right now.</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {books.map((b) => {
            const xs = items.filter((it) => it.book === b);
            const sub = xs.reduce((a, it) => a + (it.running_pnl ?? 0), 0);
            const label = b === "Active" ? "Active (auto)" : b === "Manual" ? "Manual (admin)" : b;
            return (
              <div key={b} className="rounded-md bg-paper px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-ink">{label}</span>
                  <span className={`tnum text-[14px] font-semibold ${sub >= 0 ? "text-up" : "text-down"}`}>
                    {inr(sub)} <span className="text-[11px] font-normal text-ink3">running</span>
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5">
                  {xs.map((it) => (
                    <li key={`${it.book}-${it.symbol}-${it.leg}`} className="flex items-center justify-between text-[12.5px]">
                      <span>
                        <span className={`font-semibold ${it.side > 0 ? "text-up" : "text-down"}`}>{it.side > 0 ? "BUY" : "SELL"}</span> {it.qty} {it.symbol}
                        <span className="text-ink3"> @ {it.entry.toFixed(2)}</span>
                      </span>
                      <span className="tnum text-right">
                        <span className="text-ink2">{it.ltp == null ? "—" : it.ltp.toFixed(2)}</span>{" "}
                        <span className={`font-semibold ${(it.running_pnl ?? 0) >= 0 ? "text-up" : "text-down"}`}>{it.running_pnl == null ? "—" : inr(it.running_pnl)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink3">Each book is a separate ₹5 lakh paper book; figures are before charges.</p>
    </div>
  );
}
