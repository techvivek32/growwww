import { TRADES, BY_SESSION, OPENING_CAPITAL, netPnl } from "@/lib/book";
import { fmtMoney, fmtMoneySigned } from "@/lib/format";

/**
 * Inline SVG rather than a chart library: this is a dozen points, and keeping
 * it hand-drawn means both themes stay correct with no runtime.
 */

/** Account balance after every closed trade, ₹50,000 to close. */
export function EquityCurve({ height = 220 }: { height?: number }) {
  const points: { label: string; value: number }[] = [
    { label: "Start", value: OPENING_CAPITAL },
  ];
  let running = OPENING_CAPITAL;
  for (const t of TRADES) {
    running = +(running + netPnl(t)).toFixed(2);
    points.push({ label: `${t.day} · ${t.symbol}`, value: running });
  }

  const W = 800;
  const H = height;
  const padT = 14;
  const padB = 26;
  const values = points.map((p) => p.value);
  const min = Math.min(...values) * 0.985;
  const max = Math.max(...values) * 1.015;
  const span = max - min || 1;

  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => padT + (1 - (v - min) / span) * (H - padT - padB);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H - padB} L0,${H - padB} Z`;

  // Session boundaries, so the three days read as three days.
  const marks: { at: number; label: string }[] = [];
  let idx = 0;
  for (const s of BY_SESSION) {
    idx += s.trades.length;
    marks.push({ at: idx, label: s.day });
  }

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`Account balance rising from ${fmtMoney(OPENING_CAPITAL, 0)} to ${fmtMoney(running, 0)} across ${TRADES.length} trades`}
          className="min-w-[520px]"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--c-up)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--c-up)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* opening capital reference */}
          <line
            x1="0"
            y1={y(OPENING_CAPITAL)}
            x2={W}
            y2={y(OPENING_CAPITAL)}
            stroke="var(--c-border-strong)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {marks.slice(0, -1).map((m) => (
            <line
              key={m.label}
              x1={x(m.at)}
              y1={padT}
              x2={x(m.at)}
              y2={H - padB}
              stroke="var(--c-border)"
              strokeWidth="1"
            />
          ))}

          <path d={area} fill="url(#eq)" />
          <path
            d={line}
            fill="none"
            stroke="var(--c-up)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {points.map((p, i) => (
            <circle key={i} cx={x(i)} cy={y(p.value)} r="2.5" fill="var(--c-up)">
              <title>{`${p.label}: ${fmtMoney(p.value, 0)}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="mt-1 flex min-w-[520px] justify-between px-1 text-[11px] text-ink3">
        <span>{fmtMoney(OPENING_CAPITAL, 0)} start</span>
        {BY_SESSION.map((s) => (
          <span key={s.day}>{s.day}</span>
        ))}
        <span className="font-semibold text-up">{fmtMoney(running, 0)}</span>
      </div>
    </figure>
  );
}

/** Net P&L per session — three bars, one per NSE day in the window. */
export function DailyBars({ height = 150 }: { height?: number }) {
  const data = BY_SESSION;
  const max = Math.max(...data.map((d) => Math.abs(d.net))) || 1;
  const W = 600;
  const H = height;
  const zero = H - 24;
  const slot = W / data.length;
  const barW = Math.min(72, slot * 0.4);

  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label="Net profit and loss for each of the three sessions"
          className="min-w-[360px]"
          preserveAspectRatio="none"
        >
          <line x1="0" y1={zero} x2={W} y2={zero} stroke="var(--c-border-strong)" strokeWidth="1" />
          {data.map((d, i) => {
            const h = (Math.abs(d.net) / max) * (zero - 16);
            const cx = i * slot + slot / 2;
            return (
              <rect
                key={d.day}
                x={cx - barW / 2}
                y={d.net >= 0 ? zero - h : zero}
                width={barW}
                height={Math.max(h, 2)}
                rx="3"
                fill={d.net >= 0 ? "var(--c-up)" : "var(--c-down)"}
                opacity="0.9"
              >
                <title>{`${d.label}: ${fmtMoneySigned(d.net, 0)}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>

      <div className="mt-1 flex min-w-[360px] text-[11px]">
        {data.map((d) => (
          <div key={d.day} className="flex-1 text-center">
            <p className="font-medium text-ink2">{d.day}</p>
            <p className={`tnum ${d.net >= 0 ? "text-up" : "text-down"}`}>{fmtMoneySigned(d.net, 0)}</p>
          </div>
        ))}
      </div>
    </figure>
  );
}
