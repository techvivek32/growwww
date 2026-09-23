"use client";

import { useEffect, useRef, useState } from "react";
import { fmtMoney } from "@/lib/format";

/**
 * The detail-page chart: Groww's plain line with an area fade, coloured by
 * where price sits against the previous close, with the prev-close dashed
 * rule and range tabs. A hover crosshair reads out price and time.
 *
 * Real data only — the series comes from /api/chart per range and the 1D tab
 * refreshes every 30 seconds while mounted.
 */

export interface SeriesPayload {
  range: string;
  t: number[];
  c: number[];
  prevClose: number | null;
}

const RANGES = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"] as const;

const W = 760;
const H = 280;
const PAD = 8;

function fmtWhen(ms: number, range: string): string {
  const d = new Date(ms);
  if (range === "1D" || range === "1W") {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "2-digit",
  }).format(d);
}

export default function PriceChart({
  symbol,
  initial,
}: {
  symbol: string;
  initial: SeriesPayload | null;
}) {
  const [range, setRange] = useState<string>(initial?.range ?? "1D");
  const [series, setSeries] = useState<SeriesPayload | null>(initial);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const fetchSeries = async () => {
      try {
        const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { series: SeriesPayload | null };
        if (!cancelled && body.series) setSeries(body.series);
      } catch {
        /* keep what is on screen */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // The initial payload already covers the first render of its own range.
    const needsFetch = !(initial && range === initial.range && series === initial);
    const kick = needsFetch
      ? setTimeout(() => {
          setLoading(true);
          void fetchSeries();
        }, 0)
      : undefined;
    if (range === "1D") timer = setInterval(fetchSeries, 30_000);

    return () => {
      cancelled = true;
      if (kick) clearTimeout(kick);
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, range]);

  const points = series?.c ?? [];
  const times = series?.t ?? [];
  const prevClose = series?.prevClose ?? null;

  const all = prevClose !== null ? [...points, prevClose] : points;
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const up =
    points.length > 1 &&
    points[points.length - 1] >= (prevClose ?? points[0]);
  const stroke = up ? "var(--c-up)" : "var(--c-down)";
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const area = points.length
    ? `${line} L${x(points.length - 1).toFixed(2)},${H - PAD} L${x(0).toFixed(2)},${H - PAD} Z`
    : "";

  const hoverIdx =
    hover === null || points.length < 2
      ? null
      : Math.max(0, Math.min(points.length - 1, Math.round(((hover - PAD) / (W - PAD * 2)) * (points.length - 1))));

  return (
    <div>
      <div className="relative">
        {hoverIdx !== null && (
          <div className="pointer-events-none absolute top-0 left-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px]">
            <span className="tnum font-semibold text-ink">{fmtMoney(points[hoverIdx])}</span>
            <span className="ml-2 text-ink3">{fmtWhen(times[hoverIdx], range)}</span>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={`w-full transition-opacity ${loading ? "opacity-40" : ""}`}
          style={{ height: "min(46vw, 300px)" }}
          role="img"
          aria-label={`${symbol} price chart, ${range}`}
          onMouseMove={(e) => {
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect) return;
            setHover(((e.clientX - rect.left) / rect.width) * W);
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`fade-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {prevClose !== null && (
            <line
              x1={PAD}
              x2={W - PAD}
              y1={y(prevClose)}
              y2={y(prevClose)}
              stroke="var(--c-border-strong)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}

          {area && <path d={area} fill={`url(#fade-${symbol})`} />}
          {line && (
            <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          )}

          {hoverIdx !== null && (
            <>
              <line
                x1={x(hoverIdx)}
                x2={x(hoverIdx)}
                y1={PAD}
                y2={H - PAD}
                stroke="var(--c-border-strong)"
                strokeWidth="1"
              />
              <circle cx={x(hoverIdx)} cy={y(points[hoverIdx])} r="4" fill={stroke} stroke="var(--c-surface)" strokeWidth="2" />
            </>
          )}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              range === r
                ? "bg-surfaceh text-ink ring-1 ring-line2"
                : "text-ink3 hover:bg-surfaceh hover:text-ink"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
