# Build environments

Pick one with `--dart-define-from-file`. The value becomes a **compile-time
constant** in `lib/env.dart`, so a build has no code path to any other host.

| File | API base | Use |
|---|---|---|
| `live.json` | `https://mnhafinancials.com` | **Ship this one.** |
| `local.json` | `http://10.0.2.2:3000` | Android emulator → `next dev` on this PC |
| `lan.json` | `http://192.168.1.34:3000` | A real phone on the same Wi-Fi |

```bash
# local, on the emulator, with hot reload
flutter run --dart-define-from-file=env/local.json

# a test APK against your laptop
flutter build apk --release --dart-define-from-file=env/local.json

# the real one
flutter build apk --release --dart-define-from-file=env/live.json
```

**`10.0.2.2` is not a typo.** Inside the Android emulator, `127.0.0.1` is the
emulator itself; `10.0.2.2` is the alias for the host machine's localhost.
A real phone cannot use it — it needs `lan.json` with this PC's LAN address,
and both devices on the same network.

With no flag at all the default is **production**, so a plain
`flutter build apk` can never accidentally ship pointed at a laptop.

Any build that is not live shows its label in the app bar and a banner on the
sign-in screen, so a screenshot of local data is never mistaken for the real
account.

## Why HTTP works locally but nowhere else

`network_security_config.xml` permits cleartext for `10.0.2.2`, `localhost`,
`127.0.0.1` and the LAN address only. Every other host is HTTPS-only, in
debug and release alike — so the local escape hatch cannot be turned on a
real server.

## Emulator notes

The emulator has no `curl`, so connectivity is proved by running the app, not
by shelling in. If sign-in fails with "Could not reach the server":

1. Is `npm run dev` running on this PC, and on **port 3000**? It moves to
   3001 when 3000 is taken, and `local.json` would then point at nothing.
2. Did the build actually get the flag? A build without
   `--dart-define-from-file` silently defaults to production. The LOCAL
   badge in the app bar is the tell — no badge means it is a live build.
