import type { Metadata } from "next";
import Link from "next/link";
import { getOptionChain, isConnected, canTrade } from "@/lib/api/broker";
import { fmtNum, fmtCompact } from "@/lib/format";
import { PageHead, Pill, Card } from "@/components/ui";
import { Th } from "@/components/Table";
import OrderTicket from "@/components/OrderTicket";
import NotConnected from "@/components/NotConnected";
import type { ChainLeg } from "@/lib/types";

export const metadata: Metadata = { title: "Option Chain · MNHA Financials" };

// Reads live FNO quotes — never bake this at build time.
export const dynamic = "force-dynamic";

function fmtExpiry(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(d);
}

function pctCls(v: number | null): string {
  if (v === null) return "text-ink3";
  return v >= 0 ? "text-up" : "text-down";
}

function pctText(v: number | null): string {
  if (v === null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default async function OptionChainPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; e?: string }>;
}) {
  const params = await searchParams;
  const chain = await getOptionChain(params.u, params.e);

  if (!chain) {
    return (
      <>
        <PageHead title="Option chain" sub="NSE index options — live strikes, premiums and open interest." />
        <NotConnected
          connected={isConnected()}
          what={isConnected() ? "The chain could not be loaded" : "No option chain available"}
          detail={
            isConnected()
              ? "The strike grid comes from the instrument master and prices from the live feed; one of the two did not answer just now. Reload to retry."
              : "Option quotes come from your Groww account's live feed once credentials are configured on the server."
          }
        />
      </>
    );
  }

  const tradable = canTrade();
  const atm = chain.rows.reduce(
    (best, r) => (Math.abs(r.strike - chain.spot) < Math.abs(best - chain.spot) ? r.strike : best),
    chain.rows[0].strike,
  );
  const maxOi = Math.max(1, ...chain.rows.flatMap((r) => [r.ce?.oi ?? 0, r.pe?.oi ?? 0]));

  const legCells = (leg: ChainLeg | null, side: "ce" | "pe", strike: number) => {
    const oiBar = leg?.oi ? Math.max(2, (leg.oi / maxOi) * 100) : 0;
    const barCls = side === "ce" ? "bg-up/15" : "bg-down/15";
    const cells = [
      /* OI */
      <td key="oi" className="border-b border-line px-3 py-3 text-right text-[13px] text-ink2">
        <span className="relative inline-block">
          {oiBar > 0 && (
            <span
              className={`absolute inset-y-0 right-0 -z-10 rounded-sm ${barCls}`}
              style={{ width: `${oiBar}%`, minWidth: 2 }}
              aria-hidden="true"
            />
          )}
          <span className="tnum">{leg?.oi ? fmtCompact(leg.oi) : "—"}</span>
        </span>
      </td>,
      /* OI chg */
      <td key="oic" className={`tnum border-b border-line px-3 py-3 text-right text-[12.5px] ${pctCls(leg?.oiChgPct ?? null)}`}>
        {pctText(leg?.oiChgPct ?? null)}
      </td>,
      /* LTP + day% + buy */
      <td key="ltp" className="border-b border-line px-3 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <div>
            <span className="tnum block text-[13.5px] font-semibold text-ink">
              {leg?.ltp === null || leg?.ltp === undefined ? "—" : `₹${leg.ltp.toFixed(2)}`}
            </span>
            <span className={`tnum block text-[11px] ${pctCls(leg?.changePct ?? null)}`}>
              {pctText(leg?.changePct ?? null)}
            </span>
          </div>
          {leg && leg.ltp !== null && (
            <OrderTicket
              symbol={leg.tradingSymbol}
              company={`${chain.underlying} ${fmtNum(strike)} ${side.toUpperCase()} · ${fmtExpiry(chain.expiry)}`}
              ltp={leg.ltp}
              segment="FNO"
              lotSize={chain.lotSize}
              trigger={{ label: "B", variant: "outline" }}
              disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
            />
          )}
        </div>
      </td>,
    ];
    return side === "ce" ? cells : cells.reverse();
  };

  return (
    <>
      <PageHead
        title={`${chain.underlying} option chain`}
        sub={`Spot ${fmtNum(chain.spot, 2)} · Lot size ${chain.lotSize} · live premiums and open interest from the exchange feed`}
      />

      {/* underlying + expiry selectors — plain links, no client state */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chain.underlyings.map((u) => (
          <Link
            key={u}
            href={`/fno/chain?u=${u}`}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              u === chain.underlying
                ? "bg-brand text-white"
                : "text-ink2 ring-1 ring-line hover:bg-surfaceh hover:text-ink"
            }`}
          >
            {u}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        {chain.expiries.map((e) => (
          <Link
            key={e}
            href={`/fno/chain?u=${chain.underlying}&e=${e}`}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              e === chain.expiry
                ? "bg-surfaceh text-ink ring-1 ring-line2"
                : "text-ink3 ring-1 ring-line hover:bg-surfaceh hover:text-ink"
            }`}
          >
            {fmtExpiry(e)}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr>
              <th colSpan={3} className="border-b border-line bg-upsoft px-4 py-2.5 text-center text-[12px] font-semibold text-up">
                Calls (CE)
              </th>
              <th className="border-b border-line bg-surface2 px-4 py-2.5 text-center text-[12px] font-semibold text-ink3">
                Strike
              </th>
              <th colSpan={3} className="border-b border-line bg-downsoft px-4 py-2.5 text-center text-[12px] font-semibold text-down">
                Puts (PE)
              </th>
            </tr>
            <tr>
              <Th align="right">OI</Th>
              <Th align="right">OI chg</Th>
              <Th align="right">LTP</Th>
              <Th align="center">Price</Th>
              <Th align="right">LTP</Th>
              <Th align="right">OI chg</Th>
              <Th align="right">OI</Th>
            </tr>
          </thead>
          <tbody>
            {chain.rows.map((r) => {
              const isAtm = r.strike === atm;
              return (
                <tr key={r.strike} className={`transition-colors hover:bg-surfaceh ${isAtm ? "bg-brandsoft/60" : ""}`}>
                  {legCells(r.ce, "ce", r.strike)}
                  <td className={`border-b border-line px-4 py-3 text-center text-[13.5px] font-bold ${isAtm ? "text-brandtext" : "text-ink"}`}>
                    {fmtNum(r.strike)}
                    {isAtm && <span className="ml-1 text-[10.5px] font-semibold text-brandtext">ATM</span>}
                  </td>
                  {legCells(r.pe, "pe", r.strike)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-ink2">
          <span>
            <Pill tone="up">CE</Pill> / <Pill tone="down">PE</Pill> B places a buy for that leg
          </span>
          <span>OI in contracts · OI chg vs the previous session</span>
          <span>
            One lot = <strong className="font-semibold text-ink">{chain.lotSize} qty</strong>, from the
            instrument master
          </span>
        </div>
      </Card>
    </>
  );
}
