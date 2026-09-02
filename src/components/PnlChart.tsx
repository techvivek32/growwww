import { DAILY_PNL } from "@/lib/mock";
import { fmtMoneySigned } from "@/lib/format";

/**
 * Daily realised P&L as a zero-baseline bar chart. Inline SVG rather than a
 * chart library: it is a dozen bars, and this keeps the bundle honest and
 * both themes correct without a runtime.
 */
export default function PnlChart({ height = 200 }: { height?: number }) {
  const data = DAILY_PNL;
  const max = Math.max(...data.map((d) => Math.abs(d.pnl)));
  const scale = max || 1;

  const W = 760;
  const H = height;
  const padY = 16;
  const zero = H / 2;
  const slot = W / data.length;
  const barW = Math.min(30, slot * 0.55);

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`Daily realised profit and loss across ${data.length} sessions`}
          className="min-w-[560px]"
          preserveAspectRatio="none"
        >
          {/* zero baseline */}
          <line x1="0" y1={zero} x2={W} y2={zero} stroke="var(--c-border-strong)" strokeWidth="1" />

          {data.map((d, i) => {
            const h = (Math.abs(d.pnl) / scale) * (H / 2 - padY);
            const x = i * slot + (slot - barW) / 2;
            const y = d.pnl >= 0 ? zero - h : zero;
            return (
              <g key={d.day}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(h, 1.5)}
                  rx="2"
                  fill={d.pnl >= 0 ? "var(--c-up)" : "var(--c-down)"}
                  opacity="0.9"
                >
                  <title>{`${d.day}: ${fmtMoneySigned(d.pnl)}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Labels live outside the SVG so they never stretch with preserveAspectRatio */}
      <div className="mt-2 flex min-w-[560px] justify-between px-1 text-[10px] text-ink3">
        {data.map((d) => (
          <span key={d.day} className="flex-1 text-center whitespace-nowrap">
            {d.day.split(" ")[0]}
          </span>
        ))}
      </div>

      <figcaption className="mt-3 text-[12px] text-ink3">
        Green above the line is a profitable session, red below is a losing one. Only completed round-trips are
        counted — nothing is estimated.
      </figcaption>
    </figure>
  );
}
