# NOVA India

An NSE trading terminal that sits on top of your own **Groww** account — AI stock and F&O
alerts with entry, target and stop on every setup, plus a live order desk, positions, P&L and
a trade archive.

> **Keep your broker, upgrade your terminal.**

Currently **Phase 1: paper mode** — the whole UI runs on sample NSE data. No Groww key is
required and no real money can move.

---

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4, tokens in `src/app/globals.css` |
| Language | TypeScript (strict) |
| Deploy | Vercel — every push to `main` ships |

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
    settings/                              Groww connection + go-live checklist
  components/                              Shell, cards, tables, chart
  lib/
    format.ts                              en-IN money / lakh-crore grouping
    market.ts                              NSE session clock (Asia/Kolkata)
    nav.ts                                 Section + sub-tab config
    mock.ts                                Phase-1 fixtures (deterministic)
```

## Design

The visual language follows **Groww** — light-first, teal-green accent, thin borders, a top
nav with sub-tabs, and the index ticker strip under it. The *features* come from NOVA
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

- [x] Groww-themed UI shell, all screens, paper fixtures
- [ ] `src/lib/api/groww.ts` — quotes and candles from Yahoo `.NS`, local paper book
- [ ] Full NSE symbol universe
- [ ] TradeScope fork — NSE universe, NIFTY 50 regime gate, IST schedule
- [ ] Supabase project + `groww_trades` table
- [ ] VPS order gateway: TOTP → access token, 08:30 IST refresh job, rate-limit guards
- [ ] Live order placement + post-submit verification
- [ ] Groww WebSocket replacing Yahoo for real-time
- [ ] Paper → live toggle with confirmations

---

## Disclaimer

NOVA India is decision-support tooling, not investment advice. Setups are generated from price
and volume data and can be wrong. Orders route to your own Groww account — you place them, you
own them.
