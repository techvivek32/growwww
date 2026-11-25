import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../push.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// The notification feed, and the web's `/notifications`.
///
/// Used by members from the drawer and by the admin console as its Alerts
/// section — the same endpoint serves both, because the server scopes the
/// feed to whoever is signed in, and the admin is just another account id.
class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: const NotificationList(),
    );
  }
}

/// The app-bar bell, with the unread count on it.
///
/// Carries its own count rather than taking one from the parent screen: the
/// number changes when a push lands, when the list is opened, and when "mark
/// all read" runs — none of which the screen holding the bell knows about.
class NotificationBell extends StatefulWidget {
  const NotificationBell({super.key});

  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell> {
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
    Push.arrived.addListener(_refresh);
  }

  @override
  void dispose() {
    Push.arrived.removeListener(_refresh);
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final d = await api.notifications();
      if (mounted) setState(() => _unread = d.unread);
    } catch (_) {
      // A badge is not worth an error state. If the count cannot be read the
      // bell simply shows no number, and the list itself will say what went
      // wrong when it is opened.
    }
  }

  @override
  Widget build(BuildContext context) {
    final icon = Icon(_unread > 0 ? Icons.notifications : Icons.notifications_none);
    return IconButton(
      tooltip: _unread > 0 ? '$_unread unread' : 'Notifications',
      icon: _unread == 0
          ? icon
          : Badge.count(
              count: _unread,
              backgroundColor: T.mark,
              textColor: Colors.white,
              child: icon,
            ),
      onPressed: () async {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const NotificationsScreen()),
        );
        // Opening the list is usually where they get read, so the count is
        // re-read on the way back rather than left stale behind the bell.
        await _refresh();
      },
    );
  }
}

/// The list itself, with no Scaffold — so the admin console can drop it into
/// a section body without ending up with two app bars.
class NotificationList extends StatefulWidget {
  const NotificationList({super.key});

  @override
  State<NotificationList> createState() => _NotificationListState();
}

class _NotificationListState extends State<NotificationList> {
  int _rev = 0;

  void _reload() => setState(() => _rev++);

  @override
  void initState() {
    super.initState();
    // A push landing while this list is open should add itself to the list,
    // not wait for a manual pull-to-refresh.
    Push.arrived.addListener(_reload);
  }

  @override
  void dispose() {
    Push.arrived.removeListener(_reload);
    super.dispose();
  }

  Future<void> _markRead() async {
    try {
      await api.markNotificationsRead();
      if (mounted) _reload();
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Load<({List<Notif> items, int unread})>(
      key: ValueKey(_rev),
      load: api.notifications,
      builder: (d) {
        if (d.items.isEmpty) {
          return ListView(
            children: const [
              SizedBox(
                height: 400,
                child: Empty(
                  icon: Icons.notifications_none,
                  title: 'Nothing yet',
                  detail:
                      'Order, broker, verification, membership and settlement '
                      'notices appear here.',
                ),
              ),
            ],
          );
        }
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
          children: [
            if (d.unread > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '${d.unread} unread',
                      style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                    ),
                    TextButton(
                      onPressed: _markRead,
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        minimumSize: const Size(0, 32),
                      ),
                      child: const Text('Mark all read'),
                    ),
                  ],
                ),
              ),
            for (final n in d.items)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _Row(n: n),
              ),
          ],
        );
      },
    );
  }
}

/// One notification. Tapping it goes where the notification says to go —
/// the same route a push carries, so an alert behaves identically whether it
/// was tapped in the tray or read here later.
class _Row extends StatelessWidget {
  final Notif n;
  const _Row({required this.n});

  static const _icons = {
    'order': Icons.receipt_long_outlined,
    'broker': Icons.link,
    'account': Icons.person_outline,
    'system': Icons.notifications_outlined,
  };

  static Color _toneColour(String tone) => switch (tone) {
        'up' => T.up,
        'down' => T.down,
        'warn' => T.warn,
        _ => T.dInk3,
      };

  /// What the destination is called, in the words the app itself uses for it.
  /// Shown so the row says where it goes before it is tapped.
  static String? _destination(String route) => switch (route) {
        'home' => 'Home',
        'markets' => 'Markets',
        'watchlist' => 'Watchlist',
        'portfolio' => 'Portfolio',
        'orders' => 'Orders',
        'account' => 'Account',
        'analysis' => 'Analysis',
        'admin' => 'Dashboard',
        'admin:kyc' => 'Identity verification',
        'admin:accounts' => 'Accounts',
        'admin:members' => 'Members',
        'admin:orders' => 'Order log',
        'admin:fees' => 'Fee ledger',
        'admin:live' => 'Live trading',
        'admin:report' => 'Daily report',
        _ => null, // including "notifications": tapping stays here
      };

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.45);
    final to = _destination(n.route);

    return Panel(
      padding: EdgeInsets.zero,
      child: InkWell(
        // Publishing the route rather than navigating directly keeps one
        // implementation of "where does this go": the shell and the admin
        // console already each own that map for push taps, and a second copy
        // here would be the one that goes stale.
        onTap: to == null ? null : () => Push.routeRequests.value = n.route,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(13),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (!n.read) ...[
                    Container(
                      width: 7,
                      height: 7,
                      decoration: const BoxDecoration(color: T.mark, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Icon(
                    _icons[n.kind] ?? Icons.notifications_outlined,
                    size: 15,
                    color: _toneColour(n.tone),
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      n.title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: n.read ? FontWeight.w500 : FontWeight.w700,
                      ),
                    ),
                  ),
                  Text(ago(n.createdAt), style: TextStyle(fontSize: 10.5, color: muted)),
                ],
              ),
              if (n.body.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  n.body,
                  style: TextStyle(
                    fontSize: 12.5,
                    height: 1.5,
                    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65),
                  ),
                ),
              ],
              if (to != null) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(
                      'Open $to',
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: T.mark,
                      ),
                    ),
                    const Icon(Icons.chevron_right, size: 15, color: T.mark),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
