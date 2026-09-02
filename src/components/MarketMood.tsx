import { INDICES } from "@/lib/mock";
import { fmtNum, toneText } from "@/lib/format";
import { Card, CardHead, Sparkline, Pill } from "./ui";

/**
 * Market Mood. NIFTY 50 is the regime gate for the whole alert engine —
 * when it is below its 20 EMA the engine stops issuing long setups, which
 * is why it gets its own explanation rather than sitting silently in a list.
 */
export default function MarketMood() {
  const nifty = INDICES[0];
  const riskOn = nifty.changePct >= 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title="Market mood" sub="Index basket driving the regime gate" />
        <ul className="space-y-3">
          {INDICES.map((ix) => (
            <li key={ix.symbol} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">{ix.symbol}</p>
                <p className="truncate text-[11px] text-ink3">{ix.name}</p>
              </div>
              <Sparkline points={ix.spark} up={ix.change >= 0} w={56} h={20} />
              <div className="w-[104px] text-right">
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
        <div className="flex items-center gap-2">
          <Pill tone={riskOn ? "up" : "down"}>{riskOn ? "Risk-on" : "Risk-off"}</Pill>
          <span className="text-[12px] text-ink3">NIFTY 50 · {fmtNum(nifty.last, 2)}</span>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink2">
          {riskOn
            ? "NIFTY is holding above its 20 EMA, so long setups are being published normally."
            : "NIFTY is below its 20 EMA. Long setups are throttled and position sizes are halved until the index reclaims it."}
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
