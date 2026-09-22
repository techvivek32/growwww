import type { Metadata } from "next";
import { getOptionChain } from "@/lib/api/broker";
import { fmtNum, toneText } from "@/lib/format";
import { PageHead, Pill, Card } from "@/components/ui";
import { Th, Td } from "@/components/Table";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Option Chain · MNHA Financials" };

export default async function OptionChainPage() {
  const chain = await getOptionChain();

  if (!chain || chain.rows.length === 0) {
    return (
      <>
        <PageHead title="Option chain" sub="NSE index options — strikes, open interest and implied volatility." />
        <NotConnected
          what="No option chain available"
          detail="NSE option quotes are not carried by the free price feed, so the chain comes from the broker. Connect your Groww account and live strikes appear here."
        />
      </>
    );
  }

  const atm = chain.rows.reduce(
    (best, r) => (Math.abs(r.strike - chain.spot) < Math.abs(best - chain.spot) ? r.strike : best),
    chain.rows[0].strike,
  );
  const maxOi = Math.max(...chain.rows.flatMap((r) => [r.ceOi, r.peOi]));

  return (
    <>
      <PageHead
        title={`${chain.underlying} option chain`}
        sub={`Spot ${fmtNum(chain.spot, 2)} · Expiry ${chain.expiry} · Lot size ${chain.lotSize}`}
        right={
          <div className="flex items-center gap-2">
            <Pill tone="up">Calls</Pill>
            <Pill tone="down">Puts</Pill>
          </div>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr>
              <th colSpan={4} className="border-b border-line bg-upsoft px-4 py-2.5 text-center text-[12px] font-semibold text-up">
                Calls (CE)
              </th>
              <th className="border-b border-line bg-surface2 px-4 py-2.5 text-center text-[12px] font-semibold text-ink3">
                Strike
              </th>
              <th colSpan={4} className="border-b border-line bg-downsoft px-4 py-2.5 text-center text-[12px] font-semibold text-down">
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
            {chain.rows.map((r) => {
              const isAtm = r.strike === atm;
              return (
                <tr key={r.strike} className={`transition-colors hover:bg-surfaceh ${isAtm ? "bg-brandsoft/60" : ""}`}>
                  <Td align="right" className="tnum">
                    <span className="relative inline-block">
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
                  <Td align="right" className="tnum font-semibold text-ink">
                    {r.ceLtp.toFixed(2)}
                    <span className={`ml-1 text-[11.5px] font-normal ${toneText(r.ceChg)}`}>
                      {r.ceChg >= 0 ? "+" : ""}
                      {r.ceChg.toFixed(1)}%
                    </span>
                  </Td>

                  <td className={`border-b border-line px-4 py-4 text-center text-[13.5px] font-bold ${isAtm ? "text-brandtext" : "text-ink"}`}>
                    {fmtNum(r.strike)}
                    {isAtm && <span className="ml-1 text-[10.5px] font-semibold text-brandtext">ATM</span>}
                  </td>

                  <Td align="right" className="tnum font-semibold text-ink">
                    {r.peLtp.toFixed(2)}
                    <span className={`ml-1 text-[11.5px] font-normal ${toneText(r.peChg)}`}>
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
        <p className="text-[13.5px] leading-relaxed text-ink2">
          Open interest is in lakhs of contracts. One lot is{" "}
          <strong className="font-semibold text-ink">{chain.lotSize} qty</strong> — NSE revises lot sizes
          periodically, so they are read from the instruments master rather than hard-coded.
        </p>
      </Card>
    </>
  );
}
