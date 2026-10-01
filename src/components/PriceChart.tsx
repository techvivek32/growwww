"use client";

import { useEffect, useRef, useState } from "react";
import { fmtMoney } from "@/lib/format";

/**
 * The detail-page chart: a plain line over a flat wash, coloured by where
 * price sits against the previous close, with the prev-close dashed rule and
 * range tabs. A hover crosshair reads out price and time.
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
          <div className="pointer-events-none absolute top-0 left-0 border border-line2 bg-surface px-2.5 py-1.5 text-[12px]">
            <span className="tnum font-medium text-ink">{fmtMoney(points[hoverIdx])}</span>
            <span className="ml-2 font-mono text-[11px] text-ink3">{fmtWhen(times[hoverIdx], range)}</span>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          // Stretch to the card at any width; strokes stay crisp via
          // non-scaling-stroke and the hover dot is drawn in HTML below.
          preserveAspectRatio="none"
          className={`block w-full transition-opacity ${loading ? "opacity-40" : ""}`}
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
          {prevClose !== null && (
            <line
              x1={PAD}
              x2={W - PAD}
              y1={y(prevClose)}
              y2={y(prevClose)}
              stroke="var(--c-border-strong)"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {area && <path d={area} fill={stroke} fillOpacity="0.07" />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {hoverIdx !== null && (
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={PAD}
              y2={H - PAD}
              stroke="var(--c-border-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hoverIdx !== null && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
            style={{
              left: `${(x(hoverIdx) / W) * 100}%`,
              top: `${(y(points[hoverIdx]) / H) * 100}%`,
              background: stroke,
            }}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={`border px-2.5 py-1 font-mono text-[11.5px] tracking-[0.04em] transition-colors ${
              range === r
                ? "border-brand bg-brand text-onbrand"
                : "border-transparent text-ink3 hover:border-line hover:text-ink"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
