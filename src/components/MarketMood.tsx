import { getIndices } from "@/lib/api/yahoo";
import { fmtNum, toneText } from "@/lib/format";
import { Card, CardHead, Sparkline, Pill } from "./ui";
import { LivePrice, LiveChange } from "./Live";

/**
 * Market mood. The regime read is exactly what it says: NIFTY against its own
 * 20-day average, computed from real closes. It is a READ — nothing in the
 * engine acts on it, and the copy is careful not to claim otherwise.
 */
export default async function MarketMood() {
  const indices = await getIndices();
  const nifty = indices.find((i) => i.symbol === "NIFTY") ?? indices[0];

  // The 20 sessions ENDING YESTERDAY — today's price compared to an average
  // that includes today would be self-referential.
  const ma20 =
    nifty.spark.length >= 21
      ? nifty.spark.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
      : null;
  const riskOn = ma20 !== null ? nifty.last > ma20 : nifty.changePct >= 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title="Market mood" sub="NSE and BSE benchmarks, live" />
        <ul className="space-y-3">
          {indices.map((ix) => (
            <li key={ix.symbol} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  {ix.symbol}
                  {ix.stale && <Pill tone="warn">Snap {ix.asOf}</Pill>}
                </p>
                <p className="truncate text-[11px] text-ink3">{ix.name}</p>
              </div>
              {ix.spark.length >= 3 && (
                <Sparkline points={ix.spark} up={ix.change >= 0} baseline={ix.prevClose} w={56} h={20} />
              )}
              <div className="w-[116px] text-right">
                <p className="text-[13px] font-semibold text-ink">
                  {ix.stale ? (
                    <span className="tnum">{fmtNum(ix.last, 2)}</span>
                  ) : (
                    <LivePrice symbol={ix.symbol} initial={ix.last} plain />
                  )}
                </p>
                <p className="text-[11px]">
                  {ix.stale ? (
                    <span className={`tnum ${toneText(ix.change)}`}>
                      {ix.change >= 0 ? "+" : ""}
                      {ix.change.toFixed(2)}
                    </span>
                  ) : (
                    <LiveChange symbol={ix.symbol} initialChange={ix.change} initialPct={ix.changePct} />
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="Regime read" sub="A reading, not an enforcement — setups are not filtered by it" />
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={riskOn ? "up" : "down"}>{riskOn ? "Risk-on" : "Risk-off"}</Pill>
          <span className="tnum text-[12px] text-ink3">
            NIFTY 50 · {fmtNum(nifty.last, 2)}
            {ma20 !== null && ` · 20 DMA ${fmtNum(ma20, 2)}`}
          </span>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink2">
          {riskOn
            ? "NIFTY is holding above its 20-day average — the broad tape supports long setups."
            : "NIFTY is below its 20-day average — treat long setups with extra caution."}
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
