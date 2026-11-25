import 'package:flutter/material.dart';
import '../api/client.dart';
import '../push.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/app_drawer.dart';
import '../widgets/common.dart';
import 'account.dart';
import 'home.dart';
import 'analysis.dart';
import 'legal.dart';
import 'notifications.dart';
import 'research.dart';
import 'login.dart';
import 'markets.dart';
import 'orders.dart';
import 'portfolio.dart';
import 'watchlist.dart';

/// The signed-in container: a bottom rail over five sections.
///
/// The web app carries sixteen sections in one scrolling top rail. That works
/// with a mouse and does not work with a thumb, so this groups them into five
/// destinations and keeps the sub-sections as tabs inside each. The *content*
/// is the same; only the navigation is re-cut for the device.
class Shell extends StatefulWidget {
  /// Where the server said this account should land after sign-in. The
  /// gated paths (/consent, /connect-broker) are not built natively — they
  /// are camera- and document-bound flows — so the app explains and points
  /// at the website rather than pretending to offer them.
  final String landing;
  const Shell({super.key, required this.landing});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _tab = 0;
  // The shell owns the Scaffold that holds the drawer, but each screen has
  // its own Scaffold and AppBar — so Scaffold.of() inside a screen finds the
  // wrong one. The key lets the hamburger in any screen open this drawer.
  final _scaffold = GlobalKey<ScaffoldState>();
  Me? _me;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    // A notification tap can land before this shell exists — the app may have
    // been launched BY the tap — so the pending value is consumed here as
    // well as listened for.
    Push.routeRequests.addListener(_onPushRoute);
    _onPushRoute();
  }

  @override
  void dispose() {
    Push.routeRequests.removeListener(_onPushRoute);
    super.dispose();
  }

  void _onPushRoute() {
    final route = Push.takeRoute();
    if (route == null) return;
    // After the frame: a tap that launched the app fires while this widget is
    // still building, and pushing a route mid-build throws.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _goTo(route);
    });
  }

  /// Send a notification's route to the screen it names.
  ///
  /// An unknown route — including every `admin:*` one, which a member has no
  /// business opening — falls through to the notification list rather than
  /// doing nothing. Tapping an alert must always produce a visible result,
  /// and the list is where the alert itself can be read in full.
  void _goTo(String route) {
    const tabs = {'home': 0, 'markets': 1, 'watchlist': 2, 'portfolio': 3, 'orders': 4};
    final tab = tabs[route];
    if (tab != null) {
      // Drop anything stacked over the shell, or the new tab is selected
      // underneath a screen the user is still looking at.
      Navigator.of(context).popUntil((r) => r.isFirst);
      setState(() => _tab = tab);
      return;
    }
    final me = _me;
    if (me == null) return; // still loading; the feed is one tap away anyway
    final page = switch (route) {
      'account' => AccountScreen(me: me, onSignOut: _signOut, landing: widget.landing),
      'analysis' => const AnalysisScreen(),
      _ => const NotificationsScreen(),
    };
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final me = await api.me();
      if (!mounted) return;
      setState(() {
        _me = me;
        _loading = false;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      // An expired or rejected session is not an error to retry — it means
      // sign in again. Anything else is worth a retry button.
      if (e.unauthorised) return _signOut();
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  /// Pushes a drawer destination that is not a bottom-bar tab.
  void _open(DrawerDest d, Me me) {
    final page = switch (d) {
      DrawerDest.analysis => const AnalysisScreen(),
      DrawerDest.research => ResearchScreen(isOwner: me.isOwner),
      DrawerDest.notifications => const NotificationsScreen(),
      DrawerDest.account =>
        AccountScreen(me: me, onSignOut: _signOut, landing: widget.landing),
      DrawerDest.legal => const LegalScreen(),
    };
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  Future<void> _signOut() async {
    // Before dropping the session, not after: revoking the device is an
    // authenticated call, and a phone that is still registered would keep
    // receiving this account's order and settlement notices.
    await Push.forget();
    await api.signOut();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_error != null) {
      return Scaffold(body: ErrorState(message: _error!, onRetry: _load));
    }

    final me = _me!;
    // Five destinations for sixteen web sections. The AI desk leads because
    // it is where the web sends a member after sign-in. Account and
    // Notifications are pushed from its app bar rather than taking two of the
    // five slots — they are visited occasionally, the other five constantly.
    void openMenu() => _scaffold.currentState?.openDrawer();

    final pages = [
      HomeScreen(me: me, onSignOut: _signOut, landing: widget.landing, onMenu: openMenu),
      MarketsScreen(me: me, onMenu: openMenu),
      WatchlistScreen(onMenu: openMenu),
      PortfolioScreen(onMenu: openMenu),
      OrdersScreen(onMenu: openMenu),
    ];

    return Scaffold(
      key: _scaffold,
      drawer: AppDrawer(
        me: me,
        currentTab: _tab,
        onTab: (i) => setState(() => _tab = i),
        onPush: (d) => _open(d, me),
      ),
      body: SafeArea(bottom: false, child: pages[_tab]),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
        ),
        child: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home, color: T.mark),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.show_chart_outlined),
              selectedIcon: Icon(Icons.show_chart, color: T.mark),
              label: 'Markets',
            ),
            NavigationDestination(
              icon: Icon(Icons.bookmark_outline),
              selectedIcon: Icon(Icons.bookmark, color: T.mark),
              label: 'Watchlist',
            ),
            NavigationDestination(
              icon: Icon(Icons.pie_chart_outline),
              selectedIcon: Icon(Icons.pie_chart, color: T.mark),
              label: 'Portfolio',
            ),
            NavigationDestination(
              icon: Icon(Icons.receipt_long_outlined),
              selectedIcon: Icon(Icons.receipt_long, color: T.mark),
              label: 'Orders',
            ),
          ],
        ),
      ),
    );
  }
}

/// Loads [future] and renders one of loading / error / data, with
/// pull-to-refresh. Every data screen uses this so the three states are
/// handled identically rather than each screen inventing its own.
class Load<D> extends StatefulWidget {
  final Future<D> Function() load;
  final Widget Function(D data) builder;
  const Load({super.key, required this.load, required this.builder});

  @override
  State<Load<D>> createState() => _LoadState<D>();
}

class _LoadState<D> extends State<Load<D>> {
  late Future<D> _f;

  @override
  void initState() {
    super.initState();
    _f = widget.load();
  }

  Future<void> _refresh() async {
    final f = widget.load();
    setState(() => _f = f);
    // Awaited so the refresh indicator stays up for the real duration of the
    // request rather than snapping away immediately.
    try {
      await f;
    } catch (_) {
      /* surfaced by the builder below */
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: T.mark,
      onRefresh: _refresh,
      child: FutureBuilder<D>(
        future: _f,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            // Still scrollable, so pull-to-refresh works from the error state.
            return ListView(
              children: [
                SizedBox(
                  height: MediaQuery.of(context).size.height * 0.6,
                  child: ErrorState(
                    message: snap.error is ApiError
                        ? (snap.error as ApiError).message
                        : 'Could not reach the server.',
                    onRetry: _refresh,
                  ),
                ),
              ],
            );
          }
          return widget.builder(snap.data as D);
        },
      ),
    );
  }
}
