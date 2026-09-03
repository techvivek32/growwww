import type { Metadata } from "next";
import { getIndices } from "@/lib/api/yahoo";
import { buildChain } from "@/lib/options";
import { fmtNum, toneText } from "@/lib/format";
import { PageHead, Pill, Card } from "@/components/ui";
import { Th, Td } from "@/components/Table";

export const metadata: Metadata = { title: "F&O Options · MNHA Financials" };
export const revalidate = 300;

export default async function OptionChainPage() {
  const indices = await getIndices();
  const nifty = indices.find((i) => i.symbol === "NIFTY") ?? indices[0];
  const chain = buildChain(nifty, "NIFTY");
  const maxOi = Math.max(...chain.rows.flatMap((r) => [r.ceOi, r.peOi]));

  return (
    <>
      <PageHead
        title="NIFTY Option Chain"
        sub={`Spot ${fmtNum(chain.spot, 2)} · Expiry ${chain.expiry} (${chain.daysLeft}d) · Lot size ${chain.lot}`}
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
              <Th align="right">IV</Th>
              <Th align="right">Chg</Th>
              <Th align="right">LTP</Th>
              <Th align="center">Price</Th>
              <Th align="right">LTP</Th>
              <Th align="right">Chg</Th>
              <Th align="right">IV</Th>
              <Th align="right">OI (L)</Th>
            </tr>
          </thead>
          <tbody>
            {chain.rows.map((r) => {
              const isAtm = r.strike === chain.atm;
              const ceItm = r.strike < chain.spot;
              const peItm = r.strike > chain.spot;
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
                  <Td align="right" className="tnum">{r.ceIv.toFixed(1)}</Td>
                  <Td align="right" className={`tnum ${toneText(r.ceChg)}`}>
                    {r.ceChg >= 0 ? "+" : ""}
                    {r.ceChg.toFixed(1)}%
                  </Td>
                  <Td align="right" className={`tnum font-semibold ${ceItm ? "text-ink" : "text-ink2"}`}>
                    {r.ceLtp.toFixed(2)}
                  </Td>

                  <td className={`border-b border-line px-4 py-3 text-center text-[13px] font-bold ${isAtm ? "text-brandtext" : "text-ink"}`}>
                    {fmtNum(r.strike)}
                    {isAtm && <span className="ml-1 text-[10px] font-semibold text-brandtext">ATM</span>}
                  </td>

                  <Td align="right" className={`tnum font-semibold ${peItm ? "text-ink" : "text-ink2"}`}>
                    {r.peLtp.toFixed(2)}
                  </Td>
                  <Td align="right" className={`tnum ${toneText(r.peChg)}`}>
                    {r.peChg >= 0 ? "+" : ""}
                    {r.peChg.toFixed(1)}%
                  </Td>
                  <Td align="right" className="tnum">{r.peIv.toFixed(1)}</Td>
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
          Strikes, spacing, the {chain.lot}-share lot and the {chain.daysLeft}-day expiry are the exchange&apos;s; the
          spot is live. Premiums are Black-Scholes values with a volatility smile, so they move with the index and
          decay with time — but they are a model, not NSE&apos;s quotes. Phase 2 swaps in Groww&apos;s chain endpoint.
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-ink2">
          Open interest is in lakhs of contracts. NSE revises lot sizes periodically, so MNHA reads them from the
          instruments master rather than hard-coding them.
        </p>
      </Card>
    </>
  );
}
