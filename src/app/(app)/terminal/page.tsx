import type { Metadata } from "next";
import Link from "next/link";
import { getOptionChain, canTrade } from "@/lib/api/broker";
import { getOrders } from "@/lib/api/broker";
import { fmtNum } from "@/lib/format";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";
import TradingViewChart from "@/components/TradingViewChart";
import OrderTicket from "@/components/OrderTicket";

export const metadata: Metadata = { title: "Terminal · MNHA Financials" };

// Live account + live quotes — never bake this at build time.
export const dynamic = "force-dynamic";

/** TradingView spelling for the symbols the terminal charts. */
const TV: Record<string, string> = {
  NIFTY: "NSE:NIFTY",
  BANKNIFTY: "NSE:BANKNIFTY",
  FINNIFTY: "NSE:CNXFINANCE",
  SENSEX: "BSE:SENSEX",
};

const SYMBOL_RE = /^[A-Z0-9&-]{1,30}$/;

/**
 * The trading screen: a full TradingView chart with the live option chain
 * and working orders docked beside it — the layout Groww's own Terminal
 * uses, on this account's real data.
 */
export default async function TerminalPage({
  searchParams,
}: {
  searchParams: Promise<{ symbol?: string }>;
}) {
  const { symbol: raw } = await searchParams;
  const symbol = raw && SYMBOL_RE.test(raw.toUpperCase()) ? raw.toUpperCase() : "NIFTY";
  const tvSymbol = TV[symbol] ?? `NSE:${symbol}`;

  const [chain, orders] = await Promise.all([
    getOptionChain(TV[symbol] ? symbol : "NIFTY").catch(() => null),
    getOrders().catch(() => []),
  ]);
  const tradable = canTrade();
  const working = orders.filter((o) => o.status === "OPEN" || o.status === "TRIGGER PENDING");

  const atmIdx = chain
    ? chain.rows.reduce(
        (best, r, i) =>
          Math.abs(r.strike - chain.spot) < Math.abs(chain.rows[best].strike - chain.spot) ? i : best,
        0,
      )
    : 0;
  const nearby = chain ? chain.rows.slice(Math.max(0, atmIdx - 4), atmIdx + 5) : [];

  return (
    <>
      <PageHead
        title="Terminal"
        sub="Full chart with the live chain and your working orders docked beside it."
        right={
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(TV).map((s) => (
              <Link
                key={s}
                href={`/terminal?symbol=${s}`}
                className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  s === symbol
                    ? "bg-brand text-white"
                    : "text-ink2 ring-1 ring-line hover:bg-surfaceh hover:text-ink"
                }`}
              >
                {s}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card pad={false} className="overflow-hidden">
          <TradingViewChart tvSymbol={tvSymbol} />
        </Card>

        <aside className="min-w-0 space-y-5">
          {chain && nearby.length > 0 && (
            <Card>
              <CardHead
                title={`${chain.underlying} chain`}
                sub={`Spot ${fmtNum(chain.spot, 2)} · lot ${chain.lotSize}`}
                right={
                  <Link href={`/fno/chain?u=${chain.underlying}`} className="text-[12.5px] font-medium text-brandtext hover:opacity-75">
                    Full chain →
                  </Link>
                }
              />
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-[11px] text-ink3">
                    <th className="pb-1.5 text-left font-medium">CE</th>
                    <th className="pb-1.5 text-center font-medium">Strike</th>
                    <th className="pb-1.5 text-right font-medium">PE</th>
                  </tr>
                </thead>
                <tbody>
                  {nearby.map((r) => {
                    const isAtm = r.strike === chain.rows[atmIdx].strike;
                    return (
                      <tr key={r.strike} className={isAtm ? "bg-brandsoft/60" : ""}>
                        <td className="py-1.5 text-left">
                          {r.ce?.ltp != null ? (
                            <OrderTicket
                              symbol={r.ce.tradingSymbol}
                              company={`${chain.underlying} ${fmtNum(r.strike)} CE`}
                              ltp={r.ce.ltp}
                              segment="FNO"
                              lotSize={chain.lotSize}
                              trigger={{ label: `₹${r.ce.ltp.toFixed(1)}`, variant: "outline" }}
                              disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                            />
                          ) : (
                            <span className="text-ink3">—</span>
                          )}
                        </td>
                        <td className={`tnum py-1.5 text-center font-semibold ${isAtm ? "text-brandtext" : "text-ink"}`}>
                          {fmtNum(r.strike)}
                        </td>
                        <td className="py-1.5 text-right">
                          {r.pe?.ltp != null ? (
                            <OrderTicket
                              symbol={r.pe.tradingSymbol}
                              company={`${chain.underlying} ${fmtNum(r.strike)} PE`}
                              ltp={r.pe.ltp}
                              segment="FNO"
                              lotSize={chain.lotSize}
                              trigger={{ label: `₹${r.pe.ltp.toFixed(1)}`, variant: "outline" }}
                              disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                            />
                          ) : (
                            <span className="text-ink3">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          <Card>
            <CardHead
              title="Working orders"
              right={
                <Link href="/portfolio/orders" className="text-[12.5px] font-medium text-brandtext hover:opacity-75">
                  All orders →
                </Link>
              }
            />
            {working.length === 0 ? (
              <p className="text-[13px] text-ink3">Nothing working right now.</p>
            ) : (
              <ul className="space-y-2.5">
                {working.map((o) => (
                  <li key={o.id} className="flex items-center gap-2.5 text-[12.5px]">
                    <Pill tone={o.side === "BUY" ? "up" : "down"}>{o.side}</Pill>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{o.symbol}</span>
                    <span className="tnum text-ink3">
                      {o.filled}/{o.qty}
                    </span>
                    <Pill tone={o.status === "OPEN" ? "brand" : "warn"}>{o.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      <p className="mt-4 text-[11.5px] text-ink3">
        Chart by TradingView. Chain prices and orders are this account&apos;s live data.
      </p>
    </>
  );
}
