import type { Metadata } from "next";
import Link from "next/link";
import { getOptionChain, isConnected, canTrade } from "@/lib/api/broker";
import { fmtNum } from "@/lib/format";
import MarketMood from "@/components/MarketMood";
import NotConnected from "@/components/NotConnected";
import OrderTicket from "@/components/OrderTicket";
import { PageHead, Card, CardHead, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "F&O · MNHA Financials" };

// Reads live FNO quotes — never bake this at build time.
export const dynamic = "force-dynamic";

function fmtExpiry(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(d);
}

/**
 * The options overview: the strikes nearest the money, priced live — the
 * same "Top options" read Groww leads with — and the door into the full
 * chain. No modelled setups: an option "signal" needs IV history this feed
 * does not carry, and a made-up one would be worse than none.
 */
export default async function FnoPage() {
  const chain = await getOptionChain("NIFTY");

  if (!chain) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
        <div className="min-w-0">
          <PageHead title="F&O" sub="NSE index options, priced from the live feed." />
          <NotConnected
            connected={isConnected()}
            what={isConnected() ? "Options could not be loaded" : "No options data"}
            detail={
              isConnected()
                ? "The strike grid comes from the instrument master and prices from the live feed; one of the two did not answer just now. Reload to retry."
                : "Option quotes come from your Groww account's live feed once credentials are configured on the server."
            }
          />
        </div>
        <aside className="min-w-0">
          <MarketMood />
        </aside>
      </div>
    );
  }

  const tradable = canTrade();
  const atmIdx = chain.rows.reduce(
    (best, r, i) =>
      Math.abs(r.strike - chain.spot) < Math.abs(chain.rows[best].strike - chain.spot) ? i : best,
    0,
  );
  const nearby = chain.rows.slice(Math.max(0, atmIdx - 2), atmIdx + 3);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_352px]">
      <div className="min-w-0">
        <PageHead
          title="F&O"
          sub={`NIFTY ${fmtNum(chain.spot, 2)} · expiry ${fmtExpiry(chain.expiry)} · lot ${chain.lotSize} — live premiums around the money`}
          right={
            <Link
              href="/fno/chain"
              className="inline-flex h-9 items-center rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white hover:bg-brandh"
            >
              Full option chain
            </Link>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          {nearby.flatMap((r) =>
            (["ce", "pe"] as const).map((side) => {
              const leg = r[side];
              if (!leg || leg.ltp === null) return null;
              const name = `${chain.underlying} ${fmtNum(r.strike)} ${side.toUpperCase()}`;
              return (
                <Card key={leg.tradingSymbol} className="flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14.5px] font-bold tracking-tight text-ink">{name}</p>
                      <Pill tone={side === "ce" ? "up" : "down"}>{side.toUpperCase()}</Pill>
                      {r.strike === chain.rows[atmIdx].strike && <Pill tone="brand">ATM</Pill>}
                    </div>
                    <p className="mt-1 text-[12px] text-ink3">
                      OI {leg.oi === null ? "—" : fmtNum(leg.oi)}
                      {leg.oiChgPct !== null && (
                        <span className={leg.oiChgPct >= 0 ? "text-up" : "text-down"}>
                          {" "}
                          ({leg.oiChgPct >= 0 ? "+" : ""}
                          {leg.oiChgPct.toFixed(1)}%)
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tnum text-[16px] font-semibold text-ink">₹{leg.ltp.toFixed(2)}</p>
                    <p
                      className={`tnum text-[12px] ${
                        leg.changePct === null ? "text-ink3" : leg.changePct >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {leg.changePct === null
                        ? "—"
                        : `${leg.changePct >= 0 ? "+" : ""}${leg.changePct.toFixed(1)}%`}
                    </p>
                  </div>
                  <OrderTicket
                    symbol={leg.tradingSymbol}
                    company={`${name} · ${fmtExpiry(chain.expiry)}`}
                    ltp={leg.ltp}
                    segment="FNO"
                    lotSize={chain.lotSize}
                    trigger={{ label: "Buy", variant: "outline" }}
                    disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                  />
                </Card>
              );
            }),
          )}
        </div>

        <Card className="mt-5">
          <CardHead
            title="Why there are no option 'signals' here"
            sub="Premiums, OI and OI change above are live. A ranked option setup needs an IV history this feed does not carry — inventing one would be worse than none."
          />
          <p className="text-[13.5px] leading-relaxed text-ink2">
            Use the chain to read where open interest is building, and the Buy button on any leg to
            place a real lot-sized order. Groww accepts MARKET, LIMIT, SL and SL_M on FNO, as NRML or
            MIS — there are no bracket or cover orders.
          </p>
        </Card>
      </div>

      <aside className="min-w-0">
        <MarketMood />
      </aside>
    </div>
  );
}
