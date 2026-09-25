import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStockSnapshot, hasCredentials } from "@/lib/api/groww";
import { getChartSeries, INDEX_TICKERS } from "@/lib/api/yahoo";
import { canTrade, getAccount, getOptionChain } from "@/lib/api/broker";
import { equityName } from "@/lib/instruments";
import { CHAIN_UNDERLYINGS } from "@/lib/instruments";
import { fmtMoney, fmtNum, fmtCompact } from "@/lib/format";
import { Card, CardHead, Pill, SymbolChip } from "@/components/ui";
import { LivePrice, LiveChange } from "@/components/Live";
import PriceChart from "@/components/PriceChart";
import OrderPanel from "@/components/OrderPanel";

// Live account + live quotes — never bake this at build time.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${symbol.toUpperCase()} · MNHA Financials` };
}

const SYMBOL_RE = /^[A-Z0-9&-]{1,30}$/;

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const raw = (await params).symbol.toUpperCase();
  if (!SYMBOL_RE.test(raw)) notFound();

  const isIndex = INDEX_TICKERS.some((t) => t.symbol === raw);
  const indexName = INDEX_TICKERS.find((t) => t.symbol === raw)?.name ?? null;

  const hasChain = (CHAIN_UNDERLYINGS as readonly string[]).includes(raw);
  const [snapshot, chart, name, account, chain] = await Promise.all([
    hasCredentials() ? getStockSnapshot(raw).catch(() => null) : Promise.resolve(null),
    getChartSeries(raw, "1D"),
    isIndex ? Promise.resolve(indexName) : equityName(raw).catch(() => null),
    getAccount(),
    hasChain ? getOptionChain(raw).catch(() => null) : Promise.resolve(null),
  ]);

  // Unknown symbol: no name in the master, no chart, no quote.
  if (!name && !snapshot && !chart) notFound();

  const tradable = canTrade();
  const last = snapshot?.last ?? chart?.c.at(-1) ?? 0;
  const change = snapshot?.change ?? 0;
  const changePct = snapshot?.changePct ?? 0;
  const hasChainLink = hasChain;

  // The strikes nearest the money, both legs — Groww's "Top options" list.
  const atmIdx = chain
    ? chain.rows.reduce(
        (best, r, i) =>
          Math.abs(r.strike - chain.spot) < Math.abs(chain.rows[best].strike - chain.spot) ? i : best,
        0,
      )
    : 0;
  const topOptions = chain
    ? chain.rows
        .slice(Math.max(0, atmIdx - 2), atmIdx + 3)
        .flatMap((r) =>
          (["pe", "ce"] as const).map((side) => {
            const leg = r[side];
            return leg && leg.ltp !== null
              ? { strike: r.strike, side, ltp: leg.ltp, changePct: leg.changePct }
              : null;
          }),
        )
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, 7)
    : [];

  const stats: { k: string; v: string }[] = snapshot
    ? [
        { k: "Open", v: snapshot.dayOpen === null ? "—" : fmtMoney(snapshot.dayOpen) },
        { k: "High", v: snapshot.dayHigh === null ? "—" : fmtMoney(snapshot.dayHigh) },
        { k: "Low", v: snapshot.dayLow === null ? "—" : fmtMoney(snapshot.dayLow) },
        { k: "Prev close", v: fmtMoney(snapshot.prevClose) },
        { k: "Volume", v: snapshot.volume === null ? "—" : fmtCompact(snapshot.volume) },
        { k: "52W high", v: snapshot.week52High === null ? "—" : fmtMoney(snapshot.week52High) },
        { k: "52W low", v: snapshot.week52Low === null ? "—" : fmtMoney(snapshot.week52Low) },
        {
          k: "Circuit",
          v:
            snapshot.lowerCircuit === null || snapshot.upperCircuit === null
              ? "—"
              : `${fmtNum(snapshot.lowerCircuit, 0)}–${fmtNum(snapshot.upperCircuit, 0)}`,
        },
      ]
    : [];

  const week52Pos =
    snapshot &&
    snapshot.week52High !== null &&
    snapshot.week52Low !== null &&
    snapshot.week52High > snapshot.week52Low
      ? ((last - snapshot.week52Low) / (snapshot.week52High - snapshot.week52Low)) * 100
      : null;

  const maxDepthQty = snapshot
    ? Math.max(1, ...snapshot.buyBook.map((r) => r.qty), ...snapshot.sellBook.map((r) => r.qty))
    : 1;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {/* header */}
        <div className="mb-5 flex items-start gap-4">
          <SymbolChip symbol={raw} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                {name ?? raw}
              </h1>
              <Pill tone="neutral">{isIndex ? "Index" : "NSE"}</Pill>
              {hasChainLink && (
                <Link
                  href={`/fno/chain?u=${raw}`}
                  className="text-[13px] font-medium text-brandtext hover:opacity-75"
                >
                  Option chain →
                </Link>
              )}
            </div>
            <p className="mt-1.5 text-[24px] leading-none font-semibold tracking-[-0.02em]">
              <LivePrice symbol={raw} initial={last} />
            </p>
            <p className="mt-1 text-[13px]">
              <LiveChange symbol={raw} initialChange={change} initialPct={changePct} />
              <span className="ml-1.5 text-ink3">1D</span>
            </p>
          </div>
        </div>

        <Card>
          <PriceChart symbol={raw} initial={chart} />
        </Card>

        {stats.length > 0 && (
          <Card className="mt-5">
            <CardHead title="Today" sub="From the exchange feed, live" />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {stats.map((s) => (
                <div key={s.k}>
                  <dt className="text-[12px] text-ink3">{s.k}</dt>
                  <dd className="tnum mt-0.5 text-[13.5px] font-semibold text-ink">{s.v}</dd>
                </div>
              ))}
            </dl>
            {week52Pos !== null && (
              <div className="mt-4 border-t border-line pt-4">
                <div className="flex items-center justify-between text-[11px] text-ink3">
                  <span>52W low</span>
                  <span>52W high</span>
                </div>
                <div className="relative mt-1.5 h-1.5 rounded-full bg-surface2">
                  <span
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
                    style={{ left: `${Math.min(100, Math.max(0, week52Pos))}%` }}
                  />
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* right rail */}
      <aside className="min-w-0 space-y-5">
        {!isIndex && (
          <OrderPanel
            instrument={{
              symbol: raw,
              displayName: name ?? raw,
              exchange: "NSE",
              segment: "CASH",
              lotSize: 1,
              ltp: snapshot?.last ?? null,
              changePct: snapshot?.changePct ?? null,
            }}
            balance={account.balance}
            tradable={tradable}
          />
        )}

        {topOptions.length > 0 && (
          <Card>
            <CardHead
              title={`Top ${raw} options`}
              right={
                <Link href={`/fno/chain?u=${raw}`} className="text-[12.5px] font-medium text-brandtext hover:opacity-75">
                  Option chain →
                </Link>
              }
            />
            <ul className="divide-y divide-line">
              {topOptions.map((o) => (
                <li key={`${o.strike}-${o.side}`}>
                  <Link
                    href={`/fno/chain?u=${raw}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80"
                  >
                    <span className="text-[13px] font-medium text-ink">
                      {raw} {fmtNum(o.strike)} {o.side === "ce" ? "Call" : "Put"}
                    </span>
                    <span className="text-right">
                      <span className="tnum block text-[13px] font-semibold text-ink">
                        ₹{o.ltp.toFixed(2)}
                      </span>
                      <span
                        className={`tnum block text-[11px] ${
                          o.changePct === null ? "text-ink3" : o.changePct >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {o.changePct === null
                          ? "—"
                          : `${o.changePct >= 0 ? "+" : ""}${o.changePct.toFixed(2)}%`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {snapshot && (snapshot.buyBook.length > 0 || snapshot.sellBook.length > 0) && (
          <Card>
            <CardHead title="Market depth" sub="Top five levels each side" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-up uppercase">Buyers</p>
                <ul className="space-y-1.5">
                  {snapshot.buyBook.map((r, i) => (
                    <li key={i} className="relative flex justify-between rounded px-1.5 py-1 text-[12.5px]">
                      <span
                        className="absolute inset-y-0 left-0 -z-10 rounded bg-up/10"
                        style={{ width: `${(r.qty / maxDepthQty) * 100}%` }}
                        aria-hidden="true"
                      />
                      <span className="tnum font-medium text-ink">{r.price.toFixed(2)}</span>
                      <span className="tnum text-ink3">{fmtNum(r.qty)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-down uppercase">Sellers</p>
                <ul className="space-y-1.5">
                  {snapshot.sellBook.map((r, i) => (
                    <li key={i} className="relative flex justify-between rounded px-1.5 py-1 text-[12.5px]">
                      <span
                        className="absolute inset-y-0 right-0 -z-10 rounded bg-down/10"
                        style={{ width: `${(r.qty / maxDepthQty) * 100}%` }}
                        aria-hidden="true"
                      />
                      <span className="tnum font-medium text-ink">{r.price.toFixed(2)}</span>
                      <span className="tnum text-ink3">{fmtNum(r.qty)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {snapshot.totalBuyQty !== null && snapshot.totalSellQty !== null && (
              <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink3">
                Total bid {fmtCompact(snapshot.totalBuyQty)} · total offer {fmtCompact(snapshot.totalSellQty)}
              </p>
            )}
          </Card>
        )}
      </aside>
    </div>
  );
}
