import type { Metadata } from "next";
import Link from "next/link";
import { getQuotes } from "@/lib/api/yahoo";
import { getTicks, hasCredentials, type Tick } from "@/lib/api/groww";
import { canTrade } from "@/lib/api/broker";
import { getWatchlists } from "@/lib/watchlists";
import { fmtMoney, fmtPct, fmtCompact, toneText } from "@/lib/format";
import { PageHead, SymbolChip, Sparkline, Pill } from "@/components/ui";
import { TableWrap, Th, Td, Tr } from "@/components/Table";
import { LivePrice, LiveChange } from "@/components/Live";
import OrderTicket from "@/components/OrderTicket";
import AddStockBox from "@/components/AddStockBox";
import {
  addSymbolAction,
  createListAction,
  deleteListAction,
  removeSymbolAction,
} from "./actions";

export const metadata: Metadata = { title: "Watchlist · MNHA Financials" };

// Reads the live feed and a mutable store — never bake this at build time.
export const dynamic = "force-dynamic";

/** Where price sits between the 52-week extremes, 0–100. */
function week52Pos(t: Tick | undefined): number | null {
  if (!t || t.week52High === null || t.week52Low === null || t.week52High <= t.week52Low) return null;
  return Math.min(100, Math.max(0, ((t.last - t.week52Low) / (t.week52High - t.week52Low)) * 100));
}

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const { list: listParam } = await searchParams;
  const lists = await getWatchlists();
  const active = lists.find((l) => l.id === listParam) ?? lists[0];

  const [rows, ticks] = await Promise.all([
    active.symbols.length ? getQuotes(active.symbols) : Promise.resolve([]),
    active.symbols.length && hasCredentials()
      ? getTicks(active.symbols).catch(() => ({}) as Record<string, Tick>)
      : Promise.resolve({} as Record<string, Tick>),
  ]);
  const tradable = canTrade();

  return (
    <>
      <PageHead
        title="Watchlist"
        sub="Your lists, priced live. Add any NSE stock or index from the instrument master."
      />

      {/* list tabs + new-list form */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {lists.map((l) => (
          <span key={l.id} className="inline-flex items-center">
            <Link
              href={`/stocks/watchlist?list=${l.id}`}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                l.id === active.id
                  ? "bg-surfaceh text-ink ring-1 ring-line2"
                  : "text-ink2 ring-1 ring-line hover:bg-surfaceh hover:text-ink"
              }`}
            >
              {l.name}
              <span className="ml-1.5 text-[11px] font-normal text-ink3">{l.symbols.length}</span>
            </Link>
          </span>
        ))}

        <form action={createListAction} className="inline-flex items-center gap-1.5">
          <input
            name="name"
            placeholder="+ New list"
            maxLength={40}
            className="h-8 w-28 rounded-full border border-line bg-surface2 px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-brand"
            aria-label="New watchlist name"
          />
        </form>

        <span className="ml-auto flex items-center gap-2">
          <AddStockBox listId={active.id} action={addSymbolAction} />
          {lists.length > 1 && (
            <form action={deleteListAction}>
              <input type="hidden" name="id" value={active.id} />
              <button
                type="submit"
                className="h-9 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink3 transition-colors hover:bg-downsoft hover:text-down"
                title={`Delete "${active.name}"`}
              >
                Delete list
              </button>
            </form>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-16 text-center">
          <p className="text-[15px] font-semibold text-ink">This list is empty</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-ink3">
            Use the Add stocks box above — every NSE equity and index is searchable.
          </p>
        </div>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Stock</Th>
              <Th align="center">30-day trend</Th>
              <Th align="right">LTP</Th>
              <Th align="right">Change</Th>
              <Th align="right">1D vol</Th>
              <Th align="center">52W range</Th>
              <Th align="right">Trade</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const tick = ticks[w.symbol];
              const pos = week52Pos(tick);
              return (
                <Tr key={w.symbol}>
                  <Td>
                    <Link href={`/stock/${w.symbol}`} className="flex items-center gap-3 hover:opacity-80">
                      <SymbolChip symbol={w.symbol} size={32} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                          {w.symbol}
                          {w.stale && <Pill tone="warn">Snapshot</Pill>}
                        </p>
                        <p className="truncate text-[11px] text-ink3">{w.name}</p>
                      </div>
                    </Link>
                  </Td>
                  <Td align="center">
                    <div className="flex justify-center">
                      <Sparkline points={w.spark} up={w.change >= 0} baseline={w.prevClose} w={84} h={24} />
                    </div>
                  </Td>
                  <Td align="right" className="font-medium text-ink">
                    {w.stale ? (
                      <span className="tnum">{fmtMoney(w.last)}</span>
                    ) : (
                      <LivePrice symbol={w.symbol} initial={w.last} />
                    )}
                  </Td>
                  <Td align="right" className="font-medium">
                    {w.stale ? (
                      <span className={`tnum ${toneText(w.change)}`}>
                        {w.change >= 0 ? "+" : ""}
                        {w.change.toFixed(2)} ({fmtPct(w.changePct)})
                      </span>
                    ) : (
                      <LiveChange symbol={w.symbol} initialChange={w.change} initialPct={w.changePct} />
                    )}
                  </Td>
                  <Td align="right" className="tnum text-ink2">
                    {tick?.volume != null ? fmtCompact(tick.volume) : w.volume != null ? fmtCompact(w.volume) : "—"}
                  </Td>
                  <Td align="center">
                    {pos === null ? (
                      <span className="text-[12px] text-ink3">—</span>
                    ) : (
                      <span className="inline-flex w-24 items-center gap-1 text-[9px] text-ink3">
                        L
                        <span className="relative h-1 flex-1 rounded-full bg-surface2">
                          <span
                            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
                            style={{ left: `${pos}%` }}
                          />
                        </span>
                        H
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <OrderTicket
                      symbol={w.symbol}
                      company={w.name}
                      ltp={w.last}
                      suggestedPrice={w.last}
                      trigger={{ label: "Buy", variant: "outline" }}
                      disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                    />
                  </Td>
                  <Td align="right">
                    <form action={removeSymbolAction}>
                      <input type="hidden" name="id" value={active.id} />
                      <input type="hidden" name="symbol" value={w.symbol} />
                      <button
                        type="submit"
                        aria-label={`Remove ${w.symbol} from ${active.name}`}
                        className="grid h-7 w-7 place-items-center rounded-full text-ink3 transition-colors hover:bg-downsoft hover:text-down"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </form>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
