import Link from "next/link";
import type { Tape } from "@/lib/publicTape";
import { marketState } from "@/lib/market";
import { Arrow } from "./ui";

const fmt = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = (ms: number) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
const istDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(ms);
const dayMon = (ms: number) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(ms);

/** A quote read this long ago is no longer called "live". */
const FRESH_MS = 2 * 60_000;
const nowMs = () => Date.now();

/** Paper card with real index quotes from Groww. Missing values print a dash. */
export default function TickerCard({ tape, className = "" }: { tape: Tape; className?: string }) {
  const ms = marketState();
  const now = nowMs();
  const fresh = tape.at !== null && now - tape.at < FRESH_MS && tape.rows.some((r) => r.last !== null);
  // "Live" only when the market is open AND these quotes were just read.
  const live = ms.phase === "open" && fresh;
  const status = live ? "Live · via Groww" : ms.phase === "open" && tape.at !== null ? "Delayed · via Groww" : ms.label;
  const asOf =
    tape.at === null
      ? "Quotes unavailable"
      : `As of ${istDay(tape.at) === istDay(now) ? "" : `${dayMon(tape.at)}, `}${time(tape.at)} IST`;
  return (
    <div className={`w-full max-w-[20rem] bg-pub-paper p-5 text-pub-ink ${className}`}>
      <div className="flex items-center justify-between border-b border-pub-ink pb-2.5 font-plex text-[10.5px] tracking-[0.08em] text-[#6d685d] uppercase">
        <span>Today&apos;s tape</span>
        <span className="flex items-center gap-1.5">
          {live && <span className="live-dot h-1.5 w-1.5 bg-pub-up" />}
          {status}
        </span>
      </div>
      <ul>
        {tape.rows.map((r) => (
          <li
            key={r.symbol}
            className="grid grid-cols-[1fr_auto_4.5rem] items-baseline gap-3 border-b border-dashed border-[#d8d2c4] py-2.5 font-plex text-[13.5px]"
          >
            <span>{r.label}</span>
            <span className="tnum text-right">{r.last !== null ? fmt(r.last) : "—"}</span>
            <span
              className={`tnum text-right ${
                r.changePct === null ? "text-[#6d685d]" : r.changePct >= 0 ? "text-pub-up" : "text-pub-down"
              }`}
            >
              {r.changePct === null ? "—" : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%`}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3.5 flex items-center justify-between gap-3">
        <span className="font-plex text-[10.5px] tracking-[0.08em] text-[#6d685d] uppercase">
          {asOf}
        </span>
        <Link href="/signup" className="text-[14px] font-medium whitespace-nowrap hover:opacity-70">
          Open the desk <Arrow />
        </Link>
      </div>
    </div>
  );
}
