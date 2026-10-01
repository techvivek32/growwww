"use client";

import { useMemo, useState } from "react";

/**
 * "What a losing streak does to your capital" — plain arithmetic on numbers
 * the visitor chooses. Risking a fixed share of what is left on each trade,
 * N losses in a row leave capital × (1 − r)^N. Not a forecast.
 */

const CAPITALS = [50_000, 1_00_000, 2_00_000, 3_00_000, 5_00_000, 7_50_000, 10_00_000, 15_00_000, 25_00_000, 50_00_000];

const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

function Slider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-[11px] font-semibold tracking-[0.12em] text-pub-cream uppercase">
        {label}
        <span className="tnum font-plex text-[12px] font-normal tracking-normal normal-case">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={display}
        className="pub-range mt-2"
        style={{ ["--pct" as string]: `${fill}%` }}
      />
    </label>
  );
}

export default function RiskCalculator() {
  const [capIdx, setCapIdx] = useState(4); // ₹5,00,000
  const [risk, setRisk] = useState(2); // % of what is left, per trade
  const [streak, setStreak] = useState(8);

  const capital = CAPITALS[capIdx];
  const { left, lost, lostPct, recover, series } = useMemo(() => {
    const r = risk / 100;
    const s = Array.from({ length: streak + 1 }, (_, i) => capital * Math.pow(1 - r, i));
    const l = s[s.length - 1];
    return { left: l, lost: capital - l, lostPct: (1 - l / capital) * 100, recover: (capital / l - 1) * 100, series: s };
  }, [capital, risk, streak]);

  // Stacked area: what is left (peach) under what the streak took (accent).
  const W = 760;
  const H = 290;
  const x = (i: number) => (i / streak) * W;
  const y = (v: number) => H - (v / capital) * H;
  const line = series.map((v, i) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const kept = `M0 ${H} ${line} L${W} ${H} Z`;
  const gone = `M0 0 L${W} 0 ${series
    .map((v, i) => [i, v] as const)
    .reverse()
    .map(([i, v]) => `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ")} Z`;
  const mid = Math.round(streak / 2);

  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:items-end">
      <div className="lg:col-span-4">
        <p className="text-[15px] leading-relaxed text-pub-muted">
          Trade <strong className="font-semibold text-pub-cream">{inr(capital)}</strong>, risk{" "}
          <strong className="font-semibold text-pub-cream">{pct(risk)}</strong> a trade, and after{" "}
          <strong className="font-semibold text-pub-cream">{streak}</strong> losses in a row you are left with
        </p>
        <p className="tnum mt-3 text-[clamp(2.75rem,5vw,4rem)] leading-none text-pub-cream">{inr(left)}</p>

        <div className="mt-6 grid grid-cols-2 border-t border-pub-cream pt-4">
          <div>
            <p className="flex items-center gap-2 font-plex text-[10px] tracking-[0.1em] text-pub-muted uppercase">
              <span className="h-2.5 w-2.5 bg-pub-peach" /> You keep
            </p>
            <p className="tnum mt-1 text-[14px] text-pub-cream">{inr(left)}</p>
          </div>
          <div>
            <p className="flex items-center gap-2 font-plex text-[10px] tracking-[0.1em] text-pub-muted uppercase">
              <span className="h-2.5 w-2.5 bg-pub-accent" /> Streak costs
            </p>
            <p className="tnum mt-1 text-[14px] text-pub-cream">{inr(lost)}</p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          <Slider label="Capital" value={capIdx} display={inr(capital)} min={0} max={CAPITALS.length - 1} step={1} onChange={setCapIdx} />
          <div className="grid grid-cols-2 gap-6">
            <Slider label="Risk / trade" value={risk} display={pct(risk)} min={0.5} max={10} step={0.5} onChange={setRisk} />
            <Slider label="Losses in a row" value={streak} display={String(streak)} min={1} max={20} step={1} onChange={setStreak} />
          </div>
        </div>
      </div>

      <figure className="lg:col-span-8">
        {/* +1 keeps the 1px baseline at y=H from being half-clipped. */}
        <svg
          viewBox={`0 0 ${W} ${H + 1}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Capital falls from ${inr(capital)} to ${inr(left)} over ${streak} losing trades`}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="#3a362d" strokeWidth={1} />
          ))}
          <path d={gone} fill="#d9471f" />
          <path d={kept} fill="#f2a25e" />
          <line x1={0} x2={W} y1={H} y2={H} stroke="#3a362d" strokeWidth={1} />
        </svg>
        {/* Axis labels in HTML so they keep a readable size when the chart scales down. */}
        <div className="relative mt-1.5 h-4 font-plex text-[11px] text-pub-dim">
          <span className="absolute left-0">Trade 0</span>
          {streak >= 2 && mid !== streak && (
            <span className="absolute -translate-x-1/2" style={{ left: `${(mid / streak) * 100}%` }}>
              {mid}
            </span>
          )}
          <span className="absolute right-0">{streak}</span>
        </div>
        <figcaption className="mt-4 flex gap-4 border-t border-pub-hair pt-3 font-plex text-[10.5px] leading-relaxed tracking-[0.04em] text-pub-dim">
          <span className="shrink-0 text-pub-cream">FIG. 1</span>
          <span>
            {streak} losses at {pct(risk)} each cost {pct(lostPct)} of capital — and you then need +{pct(recover)} just to
            get back to where you started. Every strategy has losing streaks; position size decides whether you survive
            them. Arithmetic on your own inputs — not a forecast, and not MNHA&apos;s results.
          </span>
        </figcaption>
      </figure>
    </div>
  );
}
