import { getIndices } from "@/lib/api/yahoo";
import { fmtNum, toneText } from "@/lib/format";

/**
 * The thin index ticker Groww puts under its nav. Live-priced, scrolling
 * horizontally on narrow screens rather than wrapping or squeezing.
 */
export default async function IndexStrip() {
  const indices = await getIndices();

  return (
    <div className="border-b border-line bg-surface">
      <div className="no-bar mx-auto flex max-w-[1360px] items-center gap-7 overflow-x-auto px-4 py-2.5 lg:px-6">
        {indices.map((ix) => (
          <div key={ix.symbol} className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-[12px] font-semibold text-ink">{ix.symbol}</span>
            {ix.stale && (
              <span className="rounded bg-warnsoft px-1 py-0.5 text-[9px] font-semibold text-warn">
                snap {ix.asOf}
              </span>
            )}
            <span className="tnum text-[12px] text-ink2">{fmtNum(ix.last, 2)}</span>
            <span className={`tnum text-[12px] ${toneText(ix.change)}`}>
              {ix.change >= 0 ? "+" : ""}
              {ix.change.toFixed(2)} ({Math.abs(ix.changePct).toFixed(2)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
