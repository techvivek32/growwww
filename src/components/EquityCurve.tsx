"use client";

import type { EquityPoint } from "@/lib/signals/simulate";

/**
 * Two equity curves on one frame: gross (what the signals made before costs)
 * and net (what was left after brokerage, STT and slippage). The gap between
 * them is the cost drag, drawn to scale — nothing about the outcome is hidden.
 */
export default function EquityCurve({
  net,
  gross,
  startCapital,
}: {
  net: EquityPoint[];
  gross: EquityPoint[];
  startCapital: number;
}) {
  const W = 820;
  const H = 300;
  const padL = 8;
  const padR = 8;
  const padY = 16;

  const all = [...net, ...gross];
  if (all.length < 2) return null;

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const lo = Math.min(startCapital, ...all.map((p) => p.equity));
  const hi = Math.max(startCapital, ...all.map((p) => p.equity));
  const span = hi - lo || 1;

  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padY + (1 - (v - lo) / span) * (H - 2 * padY);

  const path = (pts: EquityPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)} ${y(p.equity).toFixed(1)}`).join(" ");

  const netEnd = net.at(-1)?.equity ?? startCapital;
  const netUp = netEnd >= startCapital;
  const baseY = y(startCapital);

  const fmtDate = (t: number) =>
    new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(t));
  const fmtInr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full min-w-[560px]" role="img" aria-label="Equity curve, gross vs net of costs">
        {/* starting-capital baseline */}
        <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--c-border-strong)" strokeWidth="1" strokeDasharray="2 5" />
        <text x={padL} y={baseY - 5} fontSize="10.5" fill="var(--c-text-3)">
          start {fmtInr(startCapital)}
        </text>

        {/* gross (pre-cost) — muted */}
        <path d={path(gross)} fill="none" stroke="var(--c-text-3)" strokeWidth="1.5" strokeOpacity="0.7" strokeDasharray="4 3" />
        {/* net (after cost) — coloured by outcome */}
        <path d={path(net)} fill="none" stroke={netUp ? "var(--c-up)" : "var(--c-down)"} strokeWidth="2.4" />

        {/* end markers */}
        {(() => {
          const gEnd = gross.at(-1);
          const nEnd = net.at(-1);
          return (
            <>
              {gEnd && <circle cx={x(gEnd.t)} cy={y(gEnd.equity)} r="3" fill="var(--c-text-3)" />}
              {nEnd && <circle cx={x(nEnd.t)} cy={y(nEnd.equity)} r="3.5" fill={netUp ? "var(--c-up)" : "var(--c-down)"} />}
            </>
          );
        })()}

        {/* x-axis endpoints */}
        <text x={padL} y={H + 16} fontSize="10.5" fill="var(--c-text-3)">{fmtDate(t0)}</text>
        <text x={W - padR} y={H + 16} fontSize="10.5" fill="var(--c-text-3)" textAnchor="end">{fmtDate(t1)}</text>
      </svg>

      <div className="mt-1 flex items-center gap-5 px-2 text-[11.5px] text-ink3">
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="var(--c-text-3)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Gross · {fmtInr(gross.at(-1)?.equity ?? startCapital)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={netUp ? "var(--c-up)" : "var(--c-down)"} strokeWidth="2.4" /></svg>
          Net of costs · <strong className={netUp ? "text-up" : "text-down"}>{fmtInr(netEnd)}</strong>
        </span>
      </div>
    </div>
  );
}
