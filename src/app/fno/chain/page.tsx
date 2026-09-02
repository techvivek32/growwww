import type { Metadata } from "next";
import { OPTION_CHAIN, CHAIN_SPOT, CHAIN_EXPIRY, CHAIN_LOT } from "@/lib/mock";
import { fmtNum, toneText } from "@/lib/format";
import { PageHead, Pill, Card } from "@/components/ui";
import { Th, Td } from "@/components/Table";

export const metadata: Metadata = { title: "Option Chain · NOVA India" };

/** The strike nearest spot — highlighted the way every Indian chain does it. */
function atmStrike(): number {
  return OPTION_CHAIN.reduce((best, r) =>
    Math.abs(r.strike - CHAIN_SPOT) < Math.abs(best - CHAIN_SPOT) ? r.strike : best,
  OPTION_CHAIN[0].strike);
}

export default function OptionChainPage() {
  const atm = atmStrike();
  const maxOi = Math.max(...OPTION_CHAIN.flatMap((r) => [r.ceOi, r.peOi]));

  return (
    <>
      <PageHead
        title="NIFTY Option Chain"
        sub={`Spot ${fmtNum(CHAIN_SPOT, 2)} · Expiry ${CHAIN_EXPIRY} · Lot size ${CHAIN_LOT}`}
        right={
          <div className="flex items-center gap-2">
            <Pill tone="up">Calls</Pill>
            <Pill tone="down">Puts</Pill>
          </div>
        }
      />

      <div
        className="overflow-x-auto rounded-xl border border-line bg-surface"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr>
              <th colSpan={4} className="border-b border-line bg-upsoft px-4 py-2 text-center text-[11px] font-bold tracking-wider text-up uppercase">
                Calls (CE)
              </th>
              <th className="border-b border-line bg-surface2 px-4 py-2 text-center text-[11px] font-bold tracking-wider text-ink3 uppercase">
                Strike
              </th>
              <th colSpan={4} className="border-b border-line bg-downsoft px-4 py-2 text-center text-[11px] font-bold tracking-wider text-down uppercase">
                Puts (PE)
              </th>
            </tr>
            <tr>
              <Th align="right">OI (L)</Th>
              <Th align="right">OI chg</Th>
              <Th align="right">IV</Th>
              <Th align="right">LTP</Th>
              <Th align="center">Price</Th>
              <Th align="right">LTP</Th>
              <Th align="right">IV</Th>
              <Th align="right">OI chg</Th>
              <Th align="right">OI (L)</Th>
            </tr>
          </thead>
          <tbody>
            {OPTION_CHAIN.map((r) => {
              const isAtm = r.strike === atm;
              const ceItm = r.strike < CHAIN_SPOT;
              const peItm = r.strike > CHAIN_SPOT;
              return (
                <tr
                  key={r.strike}
                  className={`transition-colors hover:bg-surfaceh ${isAtm ? "bg-brandsoft/60" : ""}`}
                >
                  <Td align="right" className="tnum">
                    <span className="relative inline-block">
                      {/* OI depth bar, so concentration reads at a glance */}
                      <span
                        className="absolute inset-y-0 right-0 -z-10 rounded-sm bg-up/15"
                        style={{ width: `${(r.ceOi / maxOi) * 100}%`, minWidth: 2 }}
                        aria-hidden="true"
                      />
                      {r.ceOi.toFixed(1)}
                    </span>
                  </Td>
                  <Td align="right" className={`tnum ${toneText(r.ceOiChg)}`}>
                    {r.ceOiChg >= 0 ? "+" : ""}
                    {r.ceOiChg.toFixed(1)}%
                  </Td>
                  <Td align="right" className="tnum">{r.ceIv.toFixed(1)}</Td>
                  <Td align="right" className={`tnum font-semibold ${ceItm ? "text-ink" : "text-ink2"}`}>
                    {r.ceLtp.toFixed(2)}
                    <span className={`ml-1 text-[11px] font-normal ${toneText(r.ceChg)}`}>
                      {r.ceChg >= 0 ? "+" : ""}
                      {r.ceChg.toFixed(1)}%
                    </span>
                  </Td>

                  <td className={`border-b border-line px-4 py-3 text-center text-[13px] font-bold ${isAtm ? "text-brandtext" : "text-ink"}`}>
                    {fmtNum(r.strike)}
                    {isAtm && <span className="ml-1 text-[10px] font-semibold text-brandtext">ATM</span>}
                  </td>

                  <Td align="right" className={`tnum font-semibold ${peItm ? "text-ink" : "text-ink2"}`}>
                    {r.peLtp.toFixed(2)}
                    <span className={`ml-1 text-[11px] font-normal ${toneText(r.peChg)}`}>
                      {r.peChg >= 0 ? "+" : ""}
                      {r.peChg.toFixed(1)}%
                    </span>
                  </Td>
                  <Td align="right" className="tnum">{r.peIv.toFixed(1)}</Td>
                  <Td align="right" className={`tnum ${toneText(r.peOiChg)}`}>
                    {r.peOiChg >= 0 ? "+" : ""}
                    {r.peOiChg.toFixed(1)}%
                  </Td>
                  <Td align="right" className="tnum">
                    <span className="relative inline-block">
                      <span
                        className="absolute inset-y-0 right-0 -z-10 rounded-sm bg-down/15"
                        style={{ width: `${(r.peOi / maxOi) * 100}%`, minWidth: 2 }}
                        aria-hidden="true"
                      />
                      {r.peOi.toFixed(1)}
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Card className="mt-4">
        <p className="text-[13px] leading-relaxed text-ink2">
          Open interest is in lakhs of contracts. One lot is{" "}
          <strong className="font-semibold text-ink">{CHAIN_LOT} qty</strong> — NSE lot sizes are revised
          periodically by the exchange, so NOVA refreshes them from the instruments master rather than hard-coding
          them.
        </p>
      </Card>
    </>
  );
}
