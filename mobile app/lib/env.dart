/// Build-time configuration.
///
/// The API host is a **compile-time constant**, injected with `--dart-define`
/// (see `env/local.json` and `env/live.json`). It is deliberately not a
/// runtime setting with a text field in the UI: a trading app whose server
/// address can be retyped is one social-engineering step from a credential
/// harvester, and the attack needs no exploit — just a convincing message
/// telling someone to "update the server".
///
/// Being a `const` also means the live build has no code path to anywhere
/// else; the local host is not merely unselected, it is absent.
///
///   flutter run   --dart-define-from-file=env/local.json
///   flutter build apk --release --dart-define-from-file=env/live.json
///
/// With no flag at all, the default is production — so a plain
/// `flutter build apk` can never accidentally ship a build pointed at a
/// laptop.
class Env {
  /// Base URL for the API, no trailing slash.
  static const apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'https://mnhafinancials.com',
  );

  /// A short label shown in the app bar for any non-production build, so a
  /// screenshot of local data can never be mistaken for the real account.
  static const label = String.fromEnvironment('ENV_LABEL', defaultValue: '');

  /// True for the production build. Everything else is treated as a test
  /// build and says so on screen.
  static bool get isLive => label.isEmpty;

  /// `10.0.2.2` is how the Android emulator reaches the host machine's
  /// localhost — `127.0.0.1` inside the emulator is the emulator itself.
  /// Flagged because cleartext HTTP is permitted only for these addresses
  /// (see android/app/src/main/res/xml/network_security_config.xml).
  static bool get isLoopback =>
      apiBase.contains('10.0.2.2') ||
      apiBase.contains('localhost') ||
      apiBase.contains('127.0.0.1');
}
