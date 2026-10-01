import type { Metadata } from "next";
import Link from "next/link";
import { getQuotes, type Quote } from "@/lib/api/yahoo";
import { getTicks, hasCredentials, type Tick } from "@/lib/api/groww";
import { canTrade } from "@/lib/api/broker";
import { getWatchlists } from "@/lib/watchlists";
import { isOwnerSession } from "@/lib/access";
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

/** Price and day change for one row — live unless the quote is a snapshot. */
function PriceCell({ w }: { w: Quote }) {
  return w.stale ? <span className="tnum">{fmtMoney(w.last)}</span> : <LivePrice symbol={w.symbol} initial={w.last} />;
}

function ChangeCell({ w }: { w: Quote }) {
  return w.stale ? (
    <span className={`tnum ${toneText(w.change)}`}>
      {w.change >= 0 ? "+" : ""}
      {w.change.toFixed(2)} ({fmtPct(w.changePct)})
    </span>
  ) : (
    <LiveChange symbol={w.symbol} initialChange={w.change} initialPct={w.changePct} />
  );
}

function RemoveButton({ listId, listName, symbol }: { listId: string; listName: string; symbol: string }) {
  return (
    <form action={removeSymbolAction}>
      <input type="hidden" name="id" value={listId} />
      <input type="hidden" name="symbol" value={symbol} />
      <button
        type="submit"
        aria-label={`Remove ${symbol} from ${listName}`}
        className="grid h-7 w-7 place-items-center text-ink3 transition-colors hover:bg-downsoft hover:text-down"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </form>
  );
}

const ctl =
  "inline-flex h-9 items-center gap-1.5 border px-3 text-[12.5px] font-medium transition-colors";

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; q?: string; edit?: string }>;
}) {
  const { list: listParam, q, edit } = await searchParams;
  const owner = await isOwnerSession();
  const filter = (q ?? "").trim().toUpperCase();
  // The lists live in one shared store, so editing them is the owner's desk
  // only — a member account reads them.
  const editing = owner && edit === "1";
  // The stored lists are the owner's own; member accounts see a neutral list of
  // the benchmark indices instead — never anyone's picks.
  const lists = owner
    ? await getWatchlists()
    : [{ id: "indices", name: "Indices", symbols: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"] }];
  const active = lists.find((l) => l.id === listParam) ?? lists[0];

  const visible = filter
    ? active.symbols.filter((s) => s.includes(filter))
    : active.symbols;

  const [rows, ticks] = await Promise.all([
    visible.length ? getQuotes(visible) : Promise.resolve([]),
    visible.length && hasCredentials()
      ? getTicks(visible).catch(() => ({}) as Record<string, Tick>)
      : Promise.resolve({} as Record<string, Tick>),
  ]);
  const tradable = canTrade();

  return (
    <>
      <PageHead
        title="Watchlist"
        sub={
          owner
            ? "Your lists, priced live. Add any NSE stock or index from the instrument master."
            : "Stocks and indices to keep an eye on, priced live from the exchange feed."
        }
        right={owner ? undefined : <Pill>View only</Pill>}
      />

      {/* list tabs + controls */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {lists.map((l) => (
          <Link
            key={l.id}
            href={`/stocks/watchlist?list=${l.id}`}
            aria-current={l.id === active.id ? "page" : undefined}
            className={`inline-flex h-9 items-center border px-3.5 text-[13px] font-medium transition-colors ${
              l.id === active.id
                ? "border-brand bg-brand text-onbrand"
                : "border-line text-ink2 hover:bg-surfaceh hover:text-ink"
            }`}
          >
            {l.name}
            <span className={`tnum ml-2 font-mono text-[11px] ${l.id === active.id ? "opacity-70" : "text-ink3"}`}>
              {l.symbols.length}
            </span>
          </Link>
        ))}

        {owner && (
          <form action={createListAction} className="inline-flex items-center">
            <input
              name="name"
              placeholder="+ New list"
              maxLength={40}
              className="h-9 w-28 border border-dashed border-line2 bg-transparent px-3 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-brand focus:border-solid"
              aria-label="New watchlist name"
            />
          </form>
        )}

        <span className={owner ? "ml-auto flex items-center gap-2" : "w-full sm:ml-auto sm:w-auto"}>
          <form action="/stocks/watchlist" className={owner ? "hidden md:block" : "w-full sm:w-auto"}>
            <input type="hidden" name="list" value={active.id} />
            <input
              name="q"
              type="search"
              defaultValue={q ?? ""}
              placeholder="Search this list"
              className="h-9 w-full border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink3 focus:border-brand sm:w-44"
              aria-label="Search within this watchlist"
            />
          </form>
          {owner && (
            <>
              <AddStockBox listId={active.id} action={addSymbolAction} />
              <Link
                href={`/stocks/watchlist?list=${active.id}${editing ? "" : "&edit=1"}`}
                className={`${ctl} ${
                  editing
                    ? "border-brand bg-brand text-onbrand"
                    : "border-line text-ink2 hover:bg-surfaceh hover:text-ink"
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                {editing ? "Done" : "Edit"}
              </Link>
              {lists.length > 1 && (
                <form action={deleteListAction}>
                  <input type="hidden" name="id" value={active.id} />
                  <button
                    type="submit"
                    className={`${ctl} border-line text-ink3 hover:bg-downsoft hover:text-down`}
                    title={`Delete "${active.name}"`}
                  >
                    Delete list
                  </button>
                </form>
              )}
            </>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="border border-line bg-surface px-6 py-16 text-center">
          <p className="pub-display text-[26px] leading-tight text-ink">
            {filter ? "Nothing matches that search" : "This list is empty"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-ink3">
            {filter
              ? `No symbol in “${active.name}” contains “${filter}”.`
              : owner
                ? "Use the Add stocks box above — every NSE equity and index is searchable."
                : "Nothing has been added to this list yet."}
          </p>
        </div>
      ) : (
        <>
          {/* phones: a plain list — symbol, price, day change */}
          <ul className="border border-line bg-surface md:hidden">
            {rows.map((w) => (
              <li key={w.symbol} className="border-b border-line last:border-0">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Link href={`/stock/${w.symbol}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <SymbolChip symbol={w.symbol} size={32} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink">
                        {w.symbol}
                        {w.stale && <Pill tone="warn">Snapshot</Pill>}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink3">{w.name}</span>
                    </span>
                  </Link>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13.5px] font-medium text-ink">
                      <PriceCell w={w} />
                    </span>
                    <span className="block text-[11.5px]">
                      <ChangeCell w={w} />
                    </span>
                  </span>
                  {owner && (
                    <span className="shrink-0">
                      <OrderTicket
                        symbol={w.symbol}
                        company={w.name}
                        ltp={w.last}
                        suggestedPrice={w.last}
                        trigger={{ label: "Buy", variant: "outline" }}
                        disabledReason={tradable ? undefined : "Order placement is disabled on this server"}
                      />
                    </span>
                  )}
                  {editing && <RemoveButton listId={active.id} listName={active.name} symbol={w.symbol} />}
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Company ({rows.length})</Th>
                  <Th align="center">Trend</Th>
                  <Th align="right">Mkt price</Th>
                  <Th align="right">1D change</Th>
                  <Th align="right">1D vol</Th>
                  <Th align="center">52W range</Th>
                  {owner && <Th align="right">Trade</Th>}
                  {editing && <Th align="right"> </Th>}
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
                        <PriceCell w={w} />
                      </Td>
                      <Td align="right" className="font-medium">
                        <ChangeCell w={w} />
                      </Td>
                      <Td align="right" className="tnum text-ink2">
                        {tick?.volume != null ? fmtCompact(tick.volume) : w.volume != null ? fmtCompact(w.volume) : "—"}
                      </Td>
                      <Td align="center">
                        {pos === null ? (
                          <span className="text-[12px] text-ink3">—</span>
                        ) : (
                          <span
                            className="inline-flex w-24 items-center gap-1.5 font-mono text-[9px] text-ink3"
                            title={`${Math.round(pos)}% of the way from the 52-week low to the high`}
                          >
                            L
                            <span className="relative h-px flex-1 bg-line2">
                              <span
                                className="absolute top-1/2 h-2.5 w-[3px] -translate-x-1/2 -translate-y-1/2 bg-ink"
                                style={{ left: `${pos}%` }}
                              />
                            </span>
                            H
                          </span>
                        )}
                      </Td>
                      {owner && (
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
                      )}
                      {editing && (
                        <Td align="right">
                          <RemoveButton listId={active.id} listName={active.name} symbol={w.symbol} />
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </div>
        </>
      )}
    </>
  );
}
