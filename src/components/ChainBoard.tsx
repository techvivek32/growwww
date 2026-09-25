"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtNum, fmtCompact } from "@/lib/format";
import { useTick } from "./LiveTicks";
import OrderPanel from "./OrderPanel";
import type { ChainLeg, OptionChain } from "@/lib/types";

/**
 * Groww's option-chain board, on this account's live data.
 *
 * The layout is theirs: Call OI · Call LTP · strike ladder · Put LTP · Put OI
 * with the percent change under every figure, red/green OI share bars under
 * each strike, the underlying and expiry as dropdowns in the ladder header,
 * a dark spot pill floating between the strikes that bracket the live level,
 * and — on picking any leg — the order panel docked on the right rather than
 * a modal over the table.
 */

function fmtExpiry(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(d);
}

function pct(v: number | null): string {
  return v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function pctCls(v: number | null): string {
  return v === null ? "text-ink3" : v >= 0 ? "text-up" : "text-down";
}

/* --------------------------------------------------------------- dropdown */

function Dropdown({
  label,
  items,
  onPick,
}: {
  label: string;
  items: { value: string; label: string; active: boolean }[];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[13px] font-semibold text-ink hover:bg-surfaceh"
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          className="absolute top-8 left-1/2 z-30 w-44 -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface py-1.5"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          {items.map((it) => (
            <li key={it.value}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(it.value);
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] hover:bg-surfaceh"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                    it.active ? "border-brand" : "border-line2"
                  }`}
                >
                  {it.active && <span className="h-2 w-2 rounded-full bg-brand" />}
                </span>
                <span className={it.active ? "font-semibold text-ink" : "text-ink2"}>{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ board */

interface Selected {
  leg: ChainLeg;
  strike: number;
  right: "CE" | "PE";
}

export default function ChainBoard({
  chain,
  balance,
  tradable,
}: {
  chain: OptionChain;
  balance: number | null;
  tradable: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selected | null>(null);

  // The pill follows the live level, not the render-time one.
  const tick = useTick(chain.underlying);
  const spot = tick?.last ?? chain.spot;
  const spotChange = tick?.change ?? null;
  const spotPct = tick?.changePct ?? null;

  const maxOi = Math.max(1, ...chain.rows.flatMap((r) => [r.ce?.oi ?? 0, r.pe?.oi ?? 0]));

  // The pill sits after the last strike below the live level.
  let pillAfter = -1;
  chain.rows.forEach((r, i) => {
    if (r.strike <= spot) pillAfter = i;
  });

  const half = (leg: ChainLeg | null, right: "CE" | "PE", strike: number) => {
    const click = () => {
      if (leg && leg.ltp !== null) setSelected({ leg, strike, right });
    };
    const on =
      selected?.leg.tradingSymbol === leg?.tradingSymbol && leg !== null ? "bg-brandsoft/50" : "";
    const clickable = leg && leg.ltp !== null ? "cursor-pointer hover:bg-surfaceh" : "";

    const oiCell = (
      <td key="oi" onClick={click} className={`px-4 py-2.5 text-right ${on} ${clickable}`}>
        <span className="tnum block text-[13px] text-ink">{leg?.oi != null ? fmtCompact(leg.oi) : "—"}</span>
        <span className={`tnum block text-[11px] ${pctCls(leg?.oiChgPct ?? null)}`}>
          {pct(leg?.oiChgPct ?? null)}
        </span>
      </td>
    );
    const ltpCell = (
      <td key="ltp" onClick={click} className={`px-4 py-2.5 text-right ${on} ${clickable}`}>
        <span className="tnum block text-[13px] font-semibold text-ink">
          {leg?.ltp != null ? `₹${leg.ltp.toFixed(2)}` : "—"}
        </span>
        <span className={`tnum block text-[11px] ${pctCls(leg?.changePct ?? null)}`}>
          {pct(leg?.changePct ?? null)}
        </span>
      </td>
    );
    return right === "CE" ? [oiCell, ltpCell] : [ltpCell, oiCell];
  };

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-line text-[12px] text-ink3">
              <th className="px-4 py-3 text-right font-medium">Call OI</th>
              <th className="px-4 py-3 text-right font-medium">Call LTP</th>
              <th className="px-2 py-2 text-center font-medium">
                <Dropdown
                  label={chain.underlying}
                  items={chain.underlyings.map((u) => ({
                    value: u,
                    label: u,
                    active: u === chain.underlying,
                  }))}
                  onPick={(u) => router.push(`/fno/chain?u=${u}`)}
                />
                <span className="mx-1 text-ink3">·</span>
                <Dropdown
                  label={fmtExpiry(chain.expiry)}
                  items={chain.expiries.map((e) => ({
                    value: e,
                    label: fmtExpiry(e),
                    active: e === chain.expiry,
                  }))}
                  onPick={(e) => router.push(`/fno/chain?u=${chain.underlying}&e=${e}`)}
                />
              </th>
              <th className="px-4 py-3 text-right font-medium">Put LTP</th>
              <th className="px-4 py-3 text-right font-medium">Put OI</th>
            </tr>
          </thead>
          <tbody>
            {chain.rows.map((r, i) => {
              const ceShare = ((r.ce?.oi ?? 0) / maxOi) * 100;
              const peShare = ((r.pe?.oi ?? 0) / maxOi) * 100;
              return (
                <ChainRowGroup key={r.strike} showPill={i === pillAfter}>
                  <tr className="border-b border-line/60">
                    {half(r.ce, "CE", r.strike)}
                    <td className="px-2 py-2.5 text-center align-middle">
                      <span className="tnum block text-[13px] font-semibold text-ink">
                        {fmtNum(r.strike)}
                      </span>
                      {/* red = call OI share, green = put OI share — Groww's mini bars */}
                      <span className="mx-auto mt-1 flex w-16 items-center justify-center gap-0.5">
                        <span
                          className="h-[3px] rounded-full bg-down/70"
                          style={{ width: `${Math.max(ceShare * 0.5, r.ce?.oi ? 4 : 0)}%` }}
                        />
                        <span
                          className="h-[3px] rounded-full bg-up/70"
                          style={{ width: `${Math.max(peShare * 0.5, r.pe?.oi ? 4 : 0)}%` }}
                        />
                      </span>
                    </td>
                    {half(r.pe, "PE", r.strike)}
                  </tr>
                  {i === pillAfter && (
                    <tr aria-hidden="true">
                      <td colSpan={5} className="relative p-0">
                        <div className="relative flex h-0 items-center justify-center">
                          <span className="absolute inset-x-0 top-0 border-t border-dashed border-line2" />
                          <span className="tnum absolute z-10 rounded-full bg-ink px-3 py-1 text-[11.5px] font-semibold text-surface">
                            {fmtNum(spot, 2)}
                            {spotChange !== null && spotPct !== null && (
                              <span className={spotChange >= 0 ? " text-[#4ade80]" : " text-[#f87171]"}>
                                {"  "}
                                {spotChange >= 0 ? "+" : ""}
                                {spotChange.toFixed(2)} ({Math.abs(spotPct).toFixed(2)}%)
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </ChainRowGroup>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* right rail: docked order panel */}
      <aside className="xl:sticky xl:top-32">
        {selected ? (
          <OrderPanel
            key={selected.leg.tradingSymbol}
            instrument={{
              symbol: selected.leg.tradingSymbol,
              displayName: `${chain.underlying} ${fmtExpiry(chain.expiry)} ${fmtNum(selected.strike)} ${
                selected.right === "CE" ? "Call" : "Put"
              }`,
              exchange: selected.leg.exchange,
              segment: "FNO",
              lotSize: chain.lotSize,
              ltp: selected.leg.ltp,
              changePct: selected.leg.changePct,
            }}
            balance={balance}
            tradable={tradable}
            onClose={() => setSelected(null)}
          />
        ) : (
          <div className="hidden rounded-lg border border-dashed border-line px-5 py-10 text-center xl:block">
            <p className="text-[13px] font-medium text-ink2">Pick any leg to trade it</p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink3">
              Click a Call or Put row and the order ticket docks here — lot-sized, live-priced.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Fragment helper so a strike row and its optional pill row stay siblings. */
function ChainRowGroup({ children }: { children: React.ReactNode; showPill: boolean }) {
  return <>{children}</>;
}
