# MNHA Financials

An NSE trading terminal that sits on top of your own **Groww** account — AI stock and F&O
alerts with entry, target and stop on every setup, plus a live order desk, positions, P&L and
a trade archive.

> **Keep your broker, upgrade your terminal.**

The UI is complete and runs on **real NSE prices from Yahoo Finance**. The Groww order
adapter is the remaining piece — see [Phase 2](#phase-2--going-live-on-groww).

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4, tokens in `src/app/globals.css` |
| Language | TypeScript (strict) |
| Deploy | Vercel — every push to `main` ships |
| Domain | [mnha.in](https://mnha.in) |

## Running locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npx eslint .     # lint
```

## Layout

```
src/
  app/
    stocks/{alerts,scanner,watchlist}      AI stock alerts, NSE scanner, watchlist
    fno/{alerts,chain}                     Index option setups, NIFTY option chain
    portfolio/{holdings,positions,orders,history,analysis}
    broker/                                Groww connection, execution stats, API limits
    settings/                              Alert thresholds, risk limits, notifications
    login/                                 Sign-in (outside the (app) route group)
  components/                              Shell, cards, tables, chart
  lib/
    api/yahoo.ts                           Live NSE quotes (.NS + indices), snapshot-backed
    snapshot.ts                            Committed real-data fallback — npm run snapshot
    alerts.ts                              Setups derived from real price/volume/trend
    options.ts                             Chain + F&O setups priced off the live spot
    book.ts                                THE trade book — one source for 4 screens
    format.ts                              en-IN money / lakh-crore grouping
    market.ts                              NSE session clock (Asia/Kolkata)
    nav.ts                                 Top-bar section list
```

## Data

**Prices are real.** `lib/api/yahoo.ts` pulls live NSE quotes from Yahoo's chart endpoint —
`RELIANCE.NS`, `^NSEI`, `^NSEBANK`, `NIFTY_MID_SELECT.NS`, `NIFTY_FIN_SERVICE.NS` — with no key
needed. Pages revalidate every 5 minutes. If Yahoo is unreachable the app falls back per-symbol
to `snapshot.ts`, a committed capture of the same real data, so a build never fails and a page
never blanks.

Yahoo is **delayed**. That is fine for research, screening and back-checking, and not fine for
execution timing; Phase 2 swaps in the Groww WebSocket behind the same signatures.

Two things Yahoo gets wrong that the adapter corrects:

- `chartPreviousClose` refers to the close before the *whole requested window*, so differencing
  it reports a three-month move as "today's change". The adapter uses the second-last daily bar.
- MIDCPNIFTY and FINNIFTY have gap-ridden daily history — July bars sitting next to today's. The
  adapter detects gaps wider than a long weekend and falls back to a 1-month window, where
  `chartPreviousClose` does resolve to the prior session.

**Setups are derived, not written.** Score, stop distance, R/R and every reason tag in
`alerts.ts` come from the day's real high–low range, real volume against its 20-session average,
and the real 30-day close series. Change the market and the setups change.

**Options are modelled.** Yahoo carries no Indian option chain, so `options.ts` prices strikes
with Black-Scholes against the live index level, real strike spacing, real lot sizes and the
real days to the next Tuesday expiry — internally consistent and market-linked, but a model
rather than NSE's quotes.

**The trade book is fixed.** `book.ts` holds twelve intraday round-trips across 31 Aug – 2 Sep
2026, from ₹50,000 of opening capital. Orders, Positions, History and Analysis all derive from
that one array, so those four screens cannot disagree. Every entry and exit traded inside its
session's real high–low range, and each position sits inside Groww's ~5x MIS margin against the
capital available that day.

## Design

The visual language follows **Groww** — light-first, teal-green accent, thin borders, and the
index ticker strip under the header. The *feature set* and the flat section rail follow NOVA
Terminal; the *look* deliberately does not.

Themes are driven entirely by CSS variables (`:root` and `.dark`), surfaced to Tailwind via
`@theme inline`. No `dark:` variants are needed at call sites — every token flips on its own.

---

## Phase 2 — going live on Groww

Phase 1 has no broker code by design. Phase 2 adds `src/lib/api/groww.ts` behind the same
function signatures the UI already calls, so the screens do not change.

### What Groww's API actually allows

| | |
|---|---|
| Cost | ₹499 + GST / month (early bird; ₹2,000 regular) |
| SDK | Python only — Node must use raw REST |
| Order types | `MARKET`, `LIMIT`, `SL`, `SL_M` |
| Products | `CNC` (delivery), `MIS` (intraday), `NRML` (F&O) |
| Brackets | **None.** Stop + target are emulated with a **GTT + OCO** pair |
| Rate limits | Orders 10/s · 250/min · Live data 10/s · 300/min |
| Live data | WebSocket, up to 1,000 instruments |
| Auth | **TOTP flow** (no daily approval). Access token still expires **06:00 IST daily** |

### Two hard constraints

**1. SEBI static IP.** Since 1 Apr 2026 order placement must originate from an IP registered
with the broker (primary + optional secondary, changeable only once every 7 days). Market data
is exempt.

⇒ **Orders cannot be placed from Vercel** — its egress IP is not fixed, and it is not
registrable. This app is the *front end*. A thin **order gateway runs on the VPS** whose IP is
whitelisted, and the UI calls that gateway. Never the browser, never a serverless function.

**2. IPv6.** `api.groww.in` is dual-stack, and Node 20+ has Happy Eyeballs on by default — so
a dual-stack host can silently egress over IPv6 and get rejected against an IPv4 whitelist. The
gateway pins the source explicitly:

```js
new https.Agent({ localAddress: process.env.GROWW_REGISTERED_IP, family: 4 })
```

Global `fetch()` must not be used on the order path — undici ignores `localAddress`.

### Roadmap

- [x] Groww-themed UI shell, every screen, on real NSE data
- [x] Sign-in — HMAC-signed httpOnly session verified in `proxy.ts`
- [x] `npm run audit` — every published figure reconciled from `book.ts`
- [ ] `src/lib/api/groww.ts` — the order adapter, IBKR-identical signatures
- [ ] Full NSE symbol universe
- [ ] TradeScope fork — NSE universe, NIFTY 50 regime gate, IST schedule
- [ ] Supabase project + `groww_trades` table
- [ ] VPS order gateway: TOTP → access token, 08:30 IST refresh job, rate-limit guards
- [ ] Live order placement + post-submit verification
- [ ] Groww WebSocket replacing Yahoo for real-time
- [ ] Live-account confirmations and safety rails

---

## Disclaimer

MNHA Financials is decision-support tooling, not investment advice. Setups are generated from price
and volume data and can be wrong. Orders route to your own Groww account — you place them, you
own them.
