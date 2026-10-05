import { priceRefusal } from "@/lib/api/broker";

/**
 * When some rows have no live price, say why — in Groww's own words when
 * Groww refused the call — instead of leaving a column of dashes unexplained.
 * Nothing is filled in: the dashes stay, this only explains them.
 */
export default async function PriceGapNote({ unpriced, total }: { unpriced: number; total: number }) {
  if (unpriced <= 0) return null;
  const r = await priceRefusal();
  return (
    <p role="status" className="mb-5 border-l-2 border-warn bg-warnsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink">
      <span className="font-semibold">
        {unpriced} of {total} without a live price.
      </span>{" "}
      {r ? (
        <>
          Groww refused live prices for this account&apos;s API key: “{r.message ?? "no reason given"}”
          <span className="tnum text-ink3">
            {" "}
            (HTTP {r.status}
            {r.code ? ` · ${r.code}` : ""})
          </span>
          . Values and P&amp;L stay blank until Groww answers; the quantities and costs above come straight from Groww.
        </>
      ) : (
        "Groww returned no price for these symbols just now. Values and P&L stay blank rather than guessed; they fill in when Groww answers."
      )}
    </p>
  );
}
