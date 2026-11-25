import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api/client.dart';
import 'env.dart';

/// Push notifications.
///
/// ## Everything here is allowed to fail
///
/// Push is a second delivery channel for notifications the server has already
/// written to the account's feed. It is never the record. So every step below
/// — Firebase starting up, the permission prompt, fetching a token, reaching
/// the server — is wrapped and swallowed, and the app carries on with the
/// in-app list exactly as it did before any of this existed. A build with no
/// `google-services.json` runs fine; it simply never receives a push.
///
/// That is also why [available] is checked with the server *before* the
/// permission prompt. Android asks for notification permission once per
/// install and remembers "no" more or less forever, so spending that single
/// prompt on an app whose server has no Firebase key would permanently
/// disable a feature that later starts working.
///
/// ## Where a tap goes
///
/// The server attaches a short route string ("orders", "admin:kyc") to each
/// message. Tapping publishes it on [routeRequests]; the signed-in shell
/// listens and navigates. An unrecognised route opens the notification list
/// rather than failing, so the server can start sending a new destination
/// before every installed app understands it.
class Push {
  Push._();

  /// Must match CHANNEL_ID in src/lib/push/fcm.ts and the channel id in
  /// AndroidManifest.xml. Android silently discards a notification addressed
  /// to a channel that does not exist, with nothing in any log to say so.
  static const channelId = 'mnha_alerts';

  static final _local = FlutterLocalNotificationsPlugin();

  /// Set once Firebase is up. False means "this build cannot receive push",
  /// which is a normal state, not an error.
  static bool _ready = false;
  static bool get ready => _ready;

  /// The server's answer to "do you have a key to send with?".
  static bool _serverReady = false;
  static bool get serverReady => _serverReady;

  /// The last token handed to the server, so sign-out can revoke exactly it.
  static String? _token;

  /// A route a notification tap asked for, waiting to be consumed by whatever
  /// is on screen. A [ValueNotifier] rather than a direct navigator call
  /// because a tap can arrive while the app is still starting, before any
  /// navigator exists — the shell reads the pending value when it mounts.
  static final routeRequests = ValueNotifier<String?>(null);

  /// Bumped whenever a notification arrives, so an open screen can refresh
  /// its unread badge without polling.
  static final arrived = ValueNotifier<int>(0);

  /// Start Firebase and the local-notification plugin. Safe to call twice.
  static Future<void> init() async {
    if (_ready) return;
    try {
      // No FirebaseOptions: on Android the google-services Gradle plugin
      // writes the project values into resources, and this reads them. When
      // google-services.json is absent the plugin was never applied, so this
      // throws — which is the signal that this build has no push.
      await Firebase.initializeApp();
    } catch (e) {
      logd('push: Firebase not configured in this build ($e)');
      return;
    }

    try {
      await _local.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@drawable/ic_notification'),
        ),
        onDidReceiveNotificationResponse: (r) => _openRoute(r.payload),
      );

      // Created explicitly rather than left to the first notification, so the
      // importance is ours. A channel's importance is fixed at creation and
      // cannot be raised later — if Android creates it implicitly at default
      // importance, order alerts never make a sound again on that install.
      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(
            const AndroidNotificationChannel(
              channelId,
              'Account and order alerts',
              description:
                  'Orders, broker connection, verification and membership notices.',
              importance: Importance.high,
            ),
          );

      // Foreground messages are NOT drawn by the system — the app is on
      // screen, so FCM hands them straight to this callback and it is up to
      // us to show anything at all.
      FirebaseMessaging.onMessage.listen(_showForeground);

      // Tapped while the app was alive but backgrounded.
      FirebaseMessaging.onMessageOpenedApp.listen(
        (m) => _openRoute(m.data['route'] as String?),
      );

      // Tapped while the app was dead: this is the message that launched it.
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _openRoute(initial.data['route'] as String?);

      // FCM retires and reissues tokens on its own (reinstall, cleared data,
      // or simple rotation). Without this the server keeps a dead token and
      // the device silently stops receiving anything.
      //
      // On the deprecation: firebase_messaging 17 marks the token API in
      // favour of register()/onRegistered, which hand back a Firebase
      // Installation ID instead. That is a new API in this very release, and
      // the value the server puts in FCM's `message.token` is documented as a
      // registration token — which is exactly what getToken()/onTokenRefresh
      // return. Switching to the FID flow would change what the server sends
      // to, so it is a migration to make deliberately and test, not a rename
      // to apply for a clean analyze. The dependency is pinned to ^17, so
      // this cannot disappear underneath us.
      // ignore: deprecated_member_use
      FirebaseMessaging.instance.onTokenRefresh.listen((t) async {
        _token = t;
        await _sendToken(t);
      });

      _ready = true;
    } catch (e) {
      logd('push: setup failed ($e)');
    }
  }

  /// Ask the server whether push is configured, then — only if it is — ask
  /// the user. Call after sign-in.
  static Future<void> register() async {
    if (!_ready) return;
    try {
      _serverReady = await api.pushAvailable();
    } catch (e) {
      logd('push: could not ask the server ($e)');
      return;
    }
    if (!_serverReady) {
      logd('push: server has no Firebase key — not prompting');
      return;
    }

    try {
      final settings = await FirebaseMessaging.instance.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        logd('push: permission denied');
        return;
      }
      // ignore: deprecated_member_use — see the note on onTokenRefresh above.
      final t = await FirebaseMessaging.instance.getToken();
      if (t == null) return;
      _token = t;
      await _sendToken(t);
    } catch (e) {
      logd('push: registration failed ($e)');
    }
  }

  /// Revoke this device at sign-out.
  ///
  /// Deliberately best-effort but attempted before the session is dropped:
  /// the call needs the session cookie to identify the caller. A phone that
  /// signs out must stop receiving that account's order and settlement
  /// notices — this is the step that makes a shared device safe.
  static Future<void> forget() async {
    final t = _token;
    _token = null;
    if (t == null) return;
    try {
      await api.pushUnregister(t);
    } catch (e) {
      logd('push: unregister failed ($e)');
    }
    try {
      // Also drop it locally, so the next sign-in mints a fresh token rather
      // than re-presenting one the server has just been told to forget.
      // ignore: deprecated_member_use — see the note on onTokenRefresh above.
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      /* the server-side removal above is what matters */
    }
  }

  static Future<void> _sendToken(String token) async {
    try {
      await api.pushRegister(token, appVersion: Env.label.isEmpty ? 'live' : Env.label);
    } catch (e) {
      logd('push: could not register the token ($e)');
    }
  }

  /// Draw a notification for a message that arrived while the app is open.
  static Future<void> _showForeground(RemoteMessage m) async {
    arrived.value++;
    final n = m.notification;
    if (n == null) return;
    try {
      await _local.show(
        // A stable id per notification, so a resend replaces its own entry
        // instead of stacking a second copy of the same alert.
        id: (m.data['id'] as String?)?.hashCode ?? m.hashCode,
        title: n.title,
        body: n.body,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            channelId,
            'Account and order alerts',
            channelDescription:
                'Orders, broker connection, verification and membership notices.',
            importance: Importance.high,
            priority: Priority.high,
            icon: '@drawable/ic_notification',
          ),
        ),
        payload: m.data['route'] as String?,
      );
    } catch (e) {
      logd('push: could not show foreground notification ($e)');
    }
  }

  static void _openRoute(String? route) {
    arrived.value++;
    // Null and unknown both end up at the feed, decided by the listener.
    routeRequests.value = (route == null || route.isEmpty) ? 'notifications' : route;
  }

  /// Consume a pending route, if any. Returns null when there is nothing
  /// waiting. Clearing on read is what stops the same tap from navigating
  /// twice when two listeners are mounted.
  static String? takeRoute() {
    final r = routeRequests.value;
    if (r != null) routeRequests.value = null;
    return r;
  }
}

/// Handles a message that arrives with the app backgrounded or killed.
///
/// Android itself draws the tray notification (the server sends a
/// `notification` block, not data alone), so there is nothing to display
/// here. It exists because firebase_messaging requires a registered
/// background handler to deliver at all, and it must be a top-level function
/// with this annotation: it runs in a separate isolate that is spun up from
/// scratch, so nothing from the app's own state is available to it.
@pragma('vm:entry-point')
Future<void> pushBackgroundHandler(RemoteMessage message) async {
  // Intentionally empty. Doing work here would mean initialising Firebase,
  // the API client and the session in a throwaway isolate for no visible
  // benefit — the tap is handled by onMessageOpenedApp once the app is back.
}
