import { getWatchlists, addSymbol, removeSymbol } from "@/lib/watchlists";
import { getQuotes } from "@/lib/api/yahoo";
import { json, guarded, fail } from "@/lib/mobileApi";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/watchlist — every list, with a live quote per symbol.
 *
 * Quotes are fetched once for the union of all lists rather than per list,
 * because a symbol on three lists is still one instrument and Yahoo's rate
 * budget is shared with the rest of the app.
 */
export async function GET() {
  return guarded(async () => {
    const lists = await getWatchlists();

    const symbols = [...new Set(lists.flatMap((l) => l.symbols))];
    const quotes = symbols.length ? await getQuotes(symbols) : [];
    const bySymbol = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

    return json({
      lists: lists.map((l) => ({
        ...l,
        // A symbol with no quote is kept, not dropped: it is on the list, and
        // silently losing a row the user added would be worse than a blank
        // price next to it.
        quotes: l.symbols.map((s) => bySymbol[s] ?? null),
      })),
    });
  });
}

/** POST /api/mobile/watchlist — `{ listId, symbol, action: "add" | "remove" }`. */
export async function POST(req: Request) {
  return guarded(async () => {
    let listId = "";
    let symbol = "";
    let action = "";
    try {
      const body = await req.json();
      listId = String(body?.listId ?? "");
      symbol = String(body?.symbol ?? "").trim().toUpperCase();
      action = String(body?.action ?? "");
    } catch {
      return fail("Expected a JSON body.", 400);
    }

    if (!listId || !symbol) return fail("listId and symbol are required.", 400);
    if (action !== "add" && action !== "remove") {
      return fail('action must be "add" or "remove".', 400);
    }

    if (action === "add") await addSymbol(listId, symbol);
    else await removeSymbol(listId, symbol);

    return json({ ok: true, lists: await getWatchlists() });
  });
}
