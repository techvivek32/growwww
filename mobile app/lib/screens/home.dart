import 'package:flutter/material.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'account.dart';
import 'notifications.dart';

/// Home — the web's `/ai`, which is now the landing page for every account.
///
/// This replaced the MNHA AI desk when the signals engine was removed
/// upstream. Nothing here is derived: the market session, the Groww link and
/// the order address are all read live, and the page says plainly that MNHA
/// places no order by itself.
///
/// It is built from the `/api/mobile/me` payload the shell already holds, so
/// opening the app costs one request rather than two.
class HomeScreen extends StatelessWidget {
  final Me me;
  final VoidCallback onSignOut;
  final String landing;
  final VoidCallback? onMenu;

  const HomeScreen({
    super.key,
    required this.me,
    required this.onSignOut,
    required this.landing,
    this.onMenu,
  });

  @override
  Widget build(BuildContext context) {
    final a = me.account;
    final m = me.market;
    final connected = a.balance != null;

    return Scaffold(
      appBar: AppBar(
        title: const Row(children: [Text('Home'), SizedBox(width: 8), EnvBadge()]),
        leading: onMenu == null
            ? null
            : IconButton(icon: const Icon(Icons.menu), onPressed: onMenu),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_none),
            tooltip: 'Notifications',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const NotificationsScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.person_outline),
            tooltip: 'Account',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) =>
                    AccountScreen(me: me, onSignOut: onSignOut, landing: landing),
              ),
            ),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 30),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
            child: Text(
              a.name.isEmpty ? 'Your desk' : a.name,
              style: const TextStyle(
                  fontSize: 26, fontWeight: FontWeight.w600, letterSpacing: -0.4),
            ),
          ),

          const SectionTitle('Session'),
          _row(context, '01', 'Market', m.label,
              note: '${m.date} · ${m.clock}',
              tone: m.isLive ? T.up : null),

          const SectionTitle('Your account'),
          _row(context, '02', 'Groww', connected ? 'Connected' : 'Not connected',
              note: connected
                  ? 'Balances and holdings are read from your own account.'
                  : 'Connect a broker on the website to see balances and holdings.',
              tone: connected ? T.up : T.warn),
          // "—" rather than ₹0 when the balance is unknown: an unknown
          // balance and an empty one are different facts.
          _row(context, '03', 'Available cash', money(a.balance)),
          if (me.nav != null)
            _row(context, '04', 'NAV', moneyCompact(me.nav!.nav),
                note: 'cash ${moneyCompact(me.nav!.cash)} · '
                    'holdings ${moneyCompact(me.nav!.holdings)}'),
          _row(context, me.nav == null ? '04' : '05', 'Order address',
              me.orderIp ?? 'Not set',
              note: me.orderIp == null
                  ? 'Orders are refused by the broker unless they leave from a '
                      'registered address.'
                  : 'Orders leave from this address, as registered with Groww.',
              tone: me.orderIp == null ? T.warn : null),

          // The automatic strategy, in the same words the website uses, from
        // the same function on the server. This is the only place a member is
        // told whether their own money is in today's trades, so it sits above
        // the disclaimers rather than below them.
        if (me.strategy != null) ...[
          const SectionTitle('Automatic strategy'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Panel(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    me.strategyTone == 'warn'
                        ? Icons.error_outline
                        : me.strategyTone == 'ink'
                            ? Icons.check_circle_outline
                            : Icons.info_outline,
                    size: 18,
                    color: me.strategyTone == 'warn'
                        ? T.warn
                        : me.strategyTone == 'ink'
                            ? T.up
                            : Theme.of(context)
                                .colorScheme
                                .onSurface
                                .withValues(alpha: 0.45),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      // The server sends one sentence that already begins
                      // "Automatic strategy: "; the heading above says that,
                      // so the prefix is dropped rather than repeated.
                      me.strategy!.replaceFirst('Automatic strategy: ', ''),
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.45,
                        color: me.strategyTone == 'warn'
                            ? T.warn
                            : Theme.of(context)
                                .colorScheme
                                .onSurface
                                .withValues(alpha: 0.75),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],

        const SectionTitle('What this app does not do'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('MNHA places no order by itself.',
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 7),
                  Text(
                    'Since April 2026 an order must originate from an IP '
                    'registered with the broker. A phone has no fixed address, '
                    'so orders are placed from the desk — never from here, and '
                    'never without you confirming them.',
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.55,
                      color:
                          Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(
    BuildContext context,
    String n,
    String label,
    String value, {
    String? note,
    Color? tone,
  }) =>
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 1),
        child: Container(
          padding: const EdgeInsets.all(13),
          color: Theme.of(context).colorScheme.surface,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 26,
                child: Text(n,
                    style: kNum.copyWith(fontSize: 10.5, color: T.ink3)),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label.toUpperCase(),
                      style: const TextStyle(
                        fontSize: 10,
                        letterSpacing: 1,
                        fontWeight: FontWeight.w600,
                        color: T.ink3,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(value,
                        style: kNum.copyWith(
                            fontSize: 16, fontWeight: FontWeight.w500, color: tone)),
                    if (note != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        note,
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.5,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.55),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      );
}
