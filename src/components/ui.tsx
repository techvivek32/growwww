import type { ReactNode } from "react";
import { fmtPct, toneText } from "@/lib/format";

/* ------------------------------------------------------------------- card */

/**
 * Groww's card: white on white, one hairline border, 8px radius, no shadow.
 * The border alone does the separating — that is what keeps the page calm.
 */
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
    <div className={`rounded-lg border border-line bg-surface ${pad ? "p-4 sm:p-5" : ""} ${className}`}>
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
        <h2 className="text-[16px] leading-snug font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {sub && <p className="mt-1 text-[13px] leading-snug text-ink3">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Groww's page-level section heading — 20px, generous space beneath. */
export function SectionHead({
  title,
  right,
  className = "",
}: {
  title: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-baseline justify-between gap-4 ${className}`}>
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h2>
      {right}
    </div>
  );
}

/** The quiet green "See more ›" Groww puts under every section. */
export function MoreLink({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-[14px] font-medium text-brandtext transition-opacity hover:opacity-75"
    >
      {children}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
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
  neutral: "bg-surface2 text-ink2",
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
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Small grey chip for the "why this setup fired" reasons. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface2 px-2.5 py-1.5 text-[11.5px] font-medium text-ink2">
      {children}
    </span>
  );
}

/** Groww's filter pill: filled when active, hairline outline when not. */
export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`rounded-full px-4 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors ${
        active
          ? "bg-surfaceh text-ink ring-1 ring-line2"
          : "text-ink2 ring-1 ring-line hover:bg-surfaceh hover:text-ink"
      }`}
    >
      {children}
    </button>
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
  const sizes = { sm: "h-9 px-3.5 text-[13px]", md: "h-11 px-5 text-[14.5px]" };
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
  const valueTone = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink";
  return (
    <Card>
      <p className="text-[12.5px] font-medium text-ink3">{label}</p>
      <p className={`tnum mt-2 text-[24px] leading-none font-semibold tracking-[-0.02em] ${valueTone}`}>
        {value}
      </p>
      {sub && <p className="mt-2 text-[12.5px] text-ink3">{sub}</p>}
    </Card>
  );
}

/* -------------------------------------------------------------- sparkline */

/**
 * Groww draws the previous close as a dashed rule behind the line, so a
 * glance tells you whether the day is above or below it without reading a
 * number. `baseline` is that value, in the same units as `points`.
 */
export function Sparkline({
  points,
  up,
  baseline,
  w = 88,
  h = 28,
  className = "",
}: {
  points: number[];
  up: boolean;
  baseline?: number;
  w?: number;
  h?: number;
  className?: string;
}) {
  if (points.length < 2) return null;

  const all = baseline === undefined ? points : [...points, baseline];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const y = (v: number) => h - ((v - min) / span) * h;
  const step = w / (points.length - 1);

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const stroke = up ? "var(--c-up)" : "var(--c-down)";

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden="true">
      {baseline !== undefined && (
        <line
          x1="0"
          x2={w}
          y1={y(baseline).toFixed(2)}
          y2={y(baseline).toFixed(2)}
          stroke="var(--c-border-strong)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* -------------------------------------------------------- change (n + pct) */

export function Change({
  change,
  pct,
  size = "sm",
}: {
  change?: number;
  pct: number;
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "text-[14px]" : "text-[13px]";
  return (
    <span className={`tnum font-medium ${toneText(pct)} ${cls}`}>
      {change !== undefined && (change >= 0 ? "+" : "") + change.toFixed(2) + " "}
      ({fmtPct(pct)})
    </span>
  );
}

/* --------------------------------------------------------- symbol avatar */

/** Groww shows a square logo tile per stock. The colour is derived from the
 *  symbol so the same stock always gets the same tile. */
const CHIP_COLORS = [
  "#5367ff", "#00b386", "#eb5b3c", "#f5a623",
  "#8b5cf6", "#0ea5e9", "#e11d48", "#0f766e",
];

export function SymbolChip({ symbol, size = 40 }: { symbol: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const bg = CHIP_COLORS[h % CHIP_COLORS.length];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-semibold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.34 }}
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink3">{sub}</p>}
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
