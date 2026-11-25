import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'api/client.dart';
import 'push.dart';
import 'screens/admin.dart';
import 'screens/login.dart';
import 'screens/shell.dart';
import 'theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Portrait only, matching the web app's phone layout. A rotating trading
  // screen is not a feature anybody asked for.
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Push, if this build has it. Awaited rather than fired off, because the
  // background handler below has to be registered before the first frame or
  // a notification that launched the app is lost — but init() swallows its
  // own failures, so a build without Firebase waits on nothing and starts
  // exactly as it always did.
  await Push.init();
  if (Push.ready) {
    try {
      FirebaseMessaging.onBackgroundMessage(pushBackgroundHandler);
    } catch (e) {
      logd('push: background handler not registered ($e)');
    }
  }

  runApp(const MnhaApp());
}

class MnhaApp extends StatelessWidget {
  const MnhaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MNHA Financials',
      debugShowCheckedModeBanner: false,
      theme: T.light(),
      darkTheme: T.dark(),
      // Light-first, like the web app: dark only when the device asks for it.
      themeMode: ThemeMode.system,
      home: const _Gate(),
    );
  }
}

/// Decides between the desk and the sign-in screen on launch.
///
/// A stored token is not treated as proof of a session — only the server can
/// say that, since the token is HMAC-signed with an eight-hour expiry the app
/// cannot inspect or extend. So this calls /me and lets the answer decide.
/// A token that has expired overnight lands the user on sign-in, not on a
/// screen that fails one request at a time.
class _Gate extends StatefulWidget {
  const _Gate();
  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  bool _checking = true;
  bool _signedIn = false;
  bool _isAdmin = false;
  /// The launch check failed on the network rather than on the session, so
  /// the stored token was kept. Surfaced so the sign-in screen can say why
  /// it is showing.
  bool _offline = false;
  final String _landing = '/ai';

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    final had = await api.restore();
    if (had) {
      try {
        final me = await api.me();
        // The session is good, so this device may receive that account's
        // alerts. Not awaited: it makes two network calls and shows a
        // permission dialog, none of which should hold up the first screen.
        unawaited(Push.register());
        if (mounted) {
          setState(() {
            _signedIn = true;
            // The admin login opens the console and nothing else. Routing it
            // into the member shell would mean every trading tab answering
            // 307, which this client reads as an expired session — a sign-in
            // that bounces straight back to the login screen.
            _isAdmin = me.role == 'admin';
          });
        }
      } on ApiError catch (e) {
        // Expired or rejected: drop the dead token so the next launch is a
        // clean sign-in rather than another failed round trip.
        if (e.unauthorised) await api.signOut();
        logd('session check failed: ${e.message}');
      } catch (e) {
        // Offline at launch. The token may well still be good, so it is NOT
        // discarded — but there is nothing to show until the network is back,
        // so the user signs in when it is.
        logd('session check could not reach server: $e');
        if (mounted) _offline = true;
      }
    }
    if (mounted) setState(() => _checking = false);
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      // The launcher splash is a dark screen with the mark; this matches it
      // so the handover is invisible rather than a flash of white.
      return const Scaffold(
        backgroundColor: T.dBg,
        body: Center(
          child: SizedBox(
            width: 26,
            height: 26,
            child: CircularProgressIndicator(strokeWidth: 2.2, color: T.mark),
          ),
        ),
      );
    }
    if (!_signedIn) {
      return LoginScreen(
        notice: _offline
            ? 'Could not reach the server. Your session is still saved — '
                'reopen the app once you are back online.'
            : null,
      );
    }
    // isRoot rather than a callback: AdminScreen signs out with its own
    // context, so the action cannot be swallowed by an unmounted caller.
    return _isAdmin ? const AdminScreen(isRoot: true) : Shell(landing: _landing);
  }
}
