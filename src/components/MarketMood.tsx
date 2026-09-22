import { getIndices } from "@/lib/api/yahoo";
import { fmtNum, toneText } from "@/lib/format";
import { Card, CardHead, Sparkline, Pill } from "./ui";

/**
 * Market Mood. NIFTY 50 is the regime gate for the whole alert engine — when
 * it closes below its 20-day average the engine throttles long setups, so it
 * gets an explanation rather than sitting silently in a list.
 */
export default async function MarketMood() {
  const indices = await getIndices();
  const nifty = indices.find((i) => i.symbol === "NIFTY") ?? indices[0];

  const ma20 =
    nifty.spark.length >= 20
      ? nifty.spark.slice(-20).reduce((a, b) => a + b, 0) / 20
      : null;
  const riskOn = ma20 !== null ? nifty.last > ma20 : nifty.changePct >= 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title="Market mood" sub="Index basket driving the regime gate" />
        <ul className="space-y-3">
          {indices.map((ix) => (
            <li key={ix.symbol} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">{ix.symbol}</p>
                <p className="truncate text-[11px] text-ink3">{ix.name}</p>
              </div>
              {ix.spark.length >= 3 && (
                <Sparkline points={ix.spark} up={ix.change >= 0} baseline={ix.prevClose} w={56} h={20} />
              )}
              <div className="w-[108px] text-right">
                <p className="tnum text-[13px] font-semibold text-ink">{fmtNum(ix.last, 2)}</p>
                <p className={`tnum text-[11px] ${toneText(ix.change)}`}>
                  {ix.change >= 0 ? "+" : ""}
                  {ix.change.toFixed(2)} ({Math.abs(ix.changePct).toFixed(2)}%)
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="Regime gate" />
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={riskOn ? "up" : "down"}>{riskOn ? "Risk-on" : "Risk-off"}</Pill>
          <span className="tnum text-[12px] text-ink3">
            NIFTY 50 · {fmtNum(nifty.last, 2)}
            {ma20 !== null && ` · 20 DMA ${fmtNum(ma20, 2)}`}
          </span>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink2">
          {riskOn
            ? "NIFTY is holding above its 20-day average, so long setups are published at full size."
            : "NIFTY is below its 20-day average. Long setups are throttled and position sizes halved until the index reclaims it."}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
          <div>
            <dt className="text-[11px] text-ink3">Session</dt>
            <dd className="text-[13px] font-medium text-ink">09:15 – 15:30 IST</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink3">Exchange</dt>
            <dd className="text-[13px] font-medium text-ink">NSE</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
