import { INDICES } from "@/lib/mock";
import { fmtNum, toneText } from "@/lib/format";

/**
 * The thin index ticker Groww puts directly under its nav. Scrolls
 * horizontally on narrow screens rather than wrapping or squeezing.
 */
export default function IndexStrip() {
  return (
    <div className="border-b border-line bg-surface">
      <div className="no-bar mx-auto flex max-w-[1360px] items-center gap-7 overflow-x-auto px-4 py-2.5 lg:px-6">
        {INDICES.map((ix) => (
          <div key={ix.symbol} className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-[12px] font-semibold text-ink">{ix.symbol}</span>
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
