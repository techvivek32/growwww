# MNHA Financials — Android app (Flutter)

A native Flutter client for the terminal. Not a WebView and not a wrapper:
real screens, drawn from JSON, in the same design language as the web app.

```
mobile app/
  lib/
    main.dart            launch gate — restores the session, or signs in
    theme.dart           the tokens from src/app/globals.css, transcribed
    api/
      client.dart        HTTP + the session cookie
      models.dart        Dart mirrors of src/lib/types.ts
    screens/             login, shell, markets, watchlist, portfolio,
                         orders, account
    widgets/common.dart  money formatting, panels, empty states, sparkline
  tool/make_icons.dart   generates the launcher icons from the palette
  test/widget_test.dart  formatting + painter unit tests
```

## It needs the API that ships with it

The web app is server-rendered — its screens call `lib/` functions directly
and never cross a JSON boundary, so before this there was nothing a native
client could read. The endpoints under **`src/app/api/mobile/`** exist for
this app, and they are a *thin* projection of the same `lib/` functions the
web pages call. No business logic lives in them.

That matters: a setup scored one way on the web and another on the phone
would be a bug nobody could find. There is one implementation of each rule,
on the server.

| Endpoint | Feeds |
|---|---|
| `POST /api/mobile/login` | Sign-in. The only public one. |
| `GET /api/mobile/me` | Account, broker connection, market session |
| `GET /api/mobile/indices` | NIFTY, BANKNIFTY, MIDCPNIFTY, FINNIFTY |
| `GET /api/mobile/alerts` | Rule-based setups (owner only) |
| `GET /api/mobile/portfolio` | Holdings, positions, NAV |
| `GET /api/mobile/orders` | Order book, and `?history=1` for closed trades |
| `GET/POST /api/mobile/watchlist` | Lists with quotes; add/remove |

**The app will not work until those are deployed.** It is built against
`https://mnhafinancials.com` with no debug switch to point it elsewhere — a
build that can be aimed at an arbitrary host is one social-engineering step
from a credential harvester.

## The session is a cookie, deliberately

Everything under `lib/` resolves the acting user through
`session.currentUserId()`, which reads the `mnha_session` cookie — and in
`broker.ts` that lookup *is* the per-user data boundary. A bearer token would
be more idiomatic for a mobile client, but the server code that enforces the
boundary cannot see one, so the phone would either read nothing or, far
worse, fall through to the house account.

So the app holds the same HMAC-signed token a browser would, in
`FlutterSecureStorage` (Android Keystore), and presents it as a Cookie
header. Same eight-hour expiry; the app can neither forge nor extend it.

## Coverage

| Web route | In the app |
|---|---|
| `/login`, `/signup` | Login, Create account (email OTP) |
| `/ai` | MNHA AI — engine, scorecards, signals |
| `/indices`, `/stocks/alerts` | Markets |
| `/stocks/watchlist` | Watchlist (add/remove writes back) |
| `/stock/[symbol]` | Tap any row — price, chart, your holding |
| `/portfolio/holdings`, `/positions` | Portfolio |
| `/portfolio/orders`, `/history` | Orders |
| `/portfolio/analysis` | Account → Analysis |
| `/stocks/scanner` | Account → Research → Scanner |
| `/stocks/alerts/backtest` | Research → Strategies |
| `/fno/chain` | Research → Chain |
| `/linked-accounts` | Research → Linked |
| `/settings`, `/membership`, `/broker` | Account |
| `/notifications` | Bell icon |
| `/legal/*` (4) | Account → Legal |
| `/admin` + members, fees, orders, access | Admin console (admin login only) |

Still web-only, and honestly so:

- **`/fno/alerts`** — not built yet. The only member-facing gap left.
- **Six admin sub-pages** — accounts, addresses, consents, kyc, paper,
  paper/report. These are the console's *write* surfaces: settling a fee,
  approving a KYC document, opening a client's account. They belong where
  there is one audit trail and a screen big enough to read what is being
  approved.

## What it deliberately does not do

- **Place orders.** Since April 2026 an order must originate from an IP
  registered with the broker. A phone has no fixed address, so it can never
  be that origin. A Buy button here would promise something the architecture
  cannot deliver.
- **KYC and the consent agreement.** Both capture camera video and documents
  and stay on the web, so there is one record of what was signed.
- **Option chain, scanner, admin console.** On the website. The chain stays
  empty until Groww provides an Indian one — Yahoo carries none, and
  modelling strikes locally would print numbers no exchange ever did.

The Account screen names each of these rather than hiding them. A missing
feature the user can find beats one they discover at the moment they need it.

## Two things the Flutter template gets wrong

Both were fixed here, and both fail silently if you regenerate the project:

1. **`INTERNET` permission** is declared only in the *debug* and *profile*
   manifests. Without it in `src/main/AndroidManifest.xml` a release build has
   no network at all — every call fails and it presents as a server problem.
2. **Release signs with the debug key.** The template's `buildTypes.release`
   points at `signingConfigs.debug`. That APK installs and runs, so the
   mistake stays invisible until Play rejects it or an update will not install
   over it.

## The signing key

`android/mnha-release.jks` and `android/key.properties` are **gitignored and
irreplaceable**. Android identifies an app by package name *plus* signing key:
lose them and you cannot ship an update to anyone who already installed it.

| | |
|---|---|
| Keystore | `android/mnha-release.jks` |
| Alias | `mnha` |
| Password | in `android/key.properties` |
| SHA-256 | `2E:76:17:B0:E9:E3:0B:3C:42:41:27:99:AA:F3:81:B7:E2:F7:B0:56:07:63:B9:E1:23:D0:58:71:A8:3C:42:A0` |

Back both up somewhere private before anything else.

## Working on it

```bash
cd "mobile app"
flutter pub get
flutter analyze          # clean
flutter test             # 8 tests
flutter build apk --release
flutter build appbundle --release    # .aab for Play
```

Icons: edit the palette in `lib/theme.dart`, mirror it in
`tool/make_icons.dart`, then `dart run tool/make_icons.dart`.

Version comes from `pubspec.yaml` (`version: 1.0.0+1` — name+code). Bump the
code for every Play upload; it must increase.
