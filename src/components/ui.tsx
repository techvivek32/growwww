import type { ReactNode } from "react";
import { fmtPct, toneText } from "@/lib/format";

/* ------------------------------------------------------------------- card */

export function Card({
  children,
  className = "",
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface ${pad ? "p-5" : ""} ${className}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {children}
    </div>
  );
}

export function CardHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] leading-snug text-ink3">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ pills */

type Tone = "brand" | "violet" | "up" | "down" | "warn" | "neutral";

const TONE: Record<Tone, string> = {
  brand: "bg-brandsoft text-brandtext",
  violet: "bg-violetsoft text-violet",
  up: "bg-upsoft text-up",
  down: "bg-downsoft text-down",
  warn: "bg-warnsoft text-warn",
  neutral: "bg-surface2 text-ink2 border border-line",
};

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[11px] font-medium whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Small grey chip used for the "why this setup fired" reasons. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface2 px-2 py-1 text-[11px] font-medium text-ink2 ring-1 ring-line">
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- buttons */

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md";
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50";
  const sizes = { sm: "h-8 px-3 text-[12px]", md: "h-11 px-5 text-[14px]" };
  const variants = {
    primary: "bg-brand text-white hover:bg-brandh",
    danger: "bg-down text-white hover:opacity-90",
    outline: "border border-line2 text-ink hover:bg-surfaceh",
    ghost: "text-ink2 hover:bg-surfaceh hover:text-ink",
  };
  return (
    <button type={type} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- stat tiles */

export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const valueTone =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <Card>
      <p className="text-[11px] font-semibold tracking-wider text-ink3 uppercase">{label}</p>
      <p className={`tnum mt-2 text-[26px] leading-none font-semibold ${valueTone}`}>{value}</p>
      {sub && <p className="mt-2 text-[12px] text-ink3">{sub}</p>}
    </Card>
  );
}

/* ------------------------------------------------------------- sparkline */

export function Sparkline({
  points,
  up,
  w = 88,
  h = 28,
  className = "",
}: {
  points: number[];
  up: boolean;
  w?: number;
  h?: number;
  className?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${(h - ((p - min) / span) * h).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--c-up)" : "var(--c-down)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ------------------------------------------------------- change (n + pct) */

export function Change({
  change,
  pct,
  size = "sm",
}: {
  change?: number;
  pct: number;
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "text-[14px]" : "text-[12px]";
  return (
    <span className={`tnum font-medium ${toneText(pct)} ${cls}`}>
      {change !== undefined && (change >= 0 ? "+" : "") + change.toFixed(2) + " "}
      ({fmtPct(pct)})
    </span>
  );
}

/* -------------------------------------------------------- symbol avatar */

/** Groww shows a square logo chip per stock. We derive a stable colour
 *  from the symbol so the same stock always gets the same chip. */
const CHIP_COLORS = [
  "#5367ff", "#00b386", "#eb5b3c", "#f5a623",
  "#8b5cf6", "#0ea5e9", "#e11d48", "#0f766e",
];

export function SymbolChip({ symbol, size = 36 }: { symbol: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const bg = CHIP_COLORS[h % CHIP_COLORS.length];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

/* ----------------------------------------------------------- page header */

export function PageHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] leading-tight font-bold tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-ink3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------ empty state */

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-surface2 text-ink3">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-ink3">{hint}</p>}
    </div>
  );
}
