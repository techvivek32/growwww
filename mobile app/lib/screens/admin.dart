import 'package:flutter/material.dart';
import '../api/client.dart';
import '../theme.dart';
import 'file_view.dart';
import '../widgets/common.dart';
import 'login.dart';
import 'shell.dart';

// The daily report is long enough to crowd this file, but it builds on the
// card/pill/line helpers below, so it is a part rather than its own library.
part 'admin_report.dart';
part 'admin_live.dart';

/// The admin console — the web's `/admin/*`, section for section.
///
/// The web lays this out as an ink sidebar with four groups. A phone has no
/// room for a permanent rail, so the same groups live in a drawer: the
/// structure and the order are preserved, only the surface changes.
///
/// Read-only. The console's write actions — settling a fee, approving a KYC
/// document, opening a client's account — stay on the web, where there is one
/// audit trail and a screen big enough to read what is being approved.
class AdminScreen extends StatefulWidget {
  /// True when the admin landed here straight after signing in, so this is
  /// the root screen and needs its own way out.
  ///
  /// Sign-out is performed by this screen using its OWN context rather than a
  /// callback closing over the caller's. The caller is `LoginScreen`, which
  /// `pushReplacement` removes from the tree — so a captured context is
  /// already unmounted by the time the button is tapped, and the guard that
  /// protects against that turns the whole action into a silent no-op.
  final bool isRoot;

  const AdminScreen({super.key, this.isRoot = false});

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _Section {
  final String view;
  final String title;
  final IconData icon;
  const _Section(this.view, this.title, this.icon);
}

/// Mirrors the web sidebar, including its group headings and order.
const _groups = <String, List<_Section>>{
  '': [_Section('overview', 'Dashboard', Icons.dashboard_outlined)],
  'CLIENTS': [
    _Section('accounts', 'Accounts', Icons.people_outline),
    _Section('kyc', 'Identity verification', Icons.verified_user_outlined),
    _Section('members', 'Members', Icons.star_outline),
    _Section('consents', 'Consent audit', Icons.description_outlined),
    _Section('access', 'Admin access log', Icons.history),
  ],
  'TRADING': [
    _Section('live', 'Live trading', Icons.bolt_outlined),
    _Section('addresses', 'Order addresses', Icons.place_outlined),
    _Section('orders', 'Order log', Icons.receipt_long_outlined),
    _Section('fees', 'Fee ledger', Icons.currency_rupee),
  ],
  'RESEARCH': [
    _Section('paper', 'Paper trading', Icons.trending_up),
    _Section('report', 'Daily report', Icons.description_outlined),
  ],
};

/// The four sections an admin opens most: the dashboard, the client list,
/// the money, and the order ledger. Everything else is a drawer away.
const _quick = <_Section>[
  _Section('overview', 'Dashboard', Icons.dashboard_outlined),
  _Section('accounts', 'Accounts', Icons.people_outline),
  _Section('fees', 'Fee ledger', Icons.currency_rupee),
  _Section('orders', 'Order log', Icons.receipt_long_outlined),
];

String _shortLabel(String view) => switch (view) {
      'overview' => 'Dashboard',
      'accounts' => 'Accounts',
      'fees' => 'Fees',
      'orders' => 'Orders',
      _ => view,
    };

class _AdminScreenState extends State<AdminScreen> {
  _Section _current = _groups['']!.first;
  final _scaffold = GlobalKey<ScaffoldState>();

  /// The bottom bar highlights a quick slot only when that section is open;
  /// viewing a drawer-only section selects "More" rather than leaving a stale
  /// slot lit.
  int get _quickIndex {
    final i = _quick.indexWhere((q) => q.view == _current.view);
    return i == -1 ? _quick.length : i;
  }

  /// Drops the session and returns to a fresh sign-in.
  ///
  /// Uses this State's own `mounted` and `context`, which are alive for as
  /// long as the screen is on screen. The previous version took a callback
  /// that closed over LoginScreen's context — already disposed by
  /// `pushReplacement` — so the mounted guard swallowed the whole action.
  Future<void> _signOut() async {
    await api.signOut();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffold,
      appBar: AppBar(
        title: Row(
          children: [Text(_current.title), const SizedBox(width: 8), const EnvBadge()],
        ),
        actions: [
          if (widget.isRoot)
            IconButton(
              icon: const Icon(Icons.logout, size: 20),
              tooltip: 'Sign out',
              onPressed: _signOut,
            ),
          const SizedBox(width: 4),
        ],
      ),
      drawer: _Drawer(
        current: _current,
        onPick: (s) => setState(() => _current = s),
      ),
      // Keyed so switching section rebuilds the loader rather than showing
      // the previous section's rows under the new title.
      body: _Body(key: ValueKey(_current.view), section: _current),
      // Ten sections behind a drawer means two taps to reach any of them.
      // The four consulted most often get a bottom slot; "More" opens the
      // drawer for the rest, so nothing is further away than it was.
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
        ),
        child: NavigationBar(
          selectedIndex: _quickIndex,
          onDestinationSelected: (i) {
            if (i == _quick.length) {
              _scaffold.currentState?.openDrawer();
              return;
            }
            setState(() => _current = _quick[i]);
          },
          destinations: [
            for (final q in _quick)
              NavigationDestination(
                icon: Icon(q.icon),
                selectedIcon: Icon(q.icon, color: T.mark),
                label: _shortLabel(q.view),
              ),
            const NavigationDestination(icon: Icon(Icons.more_horiz), label: 'More'),
          ],
        ),
      ),
    );
  }
}

/// The web's ink sidebar, as a drawer. Deliberately keeps the dark panel and
/// the vermilion active bar so the console still reads as the console.
class _Drawer extends StatelessWidget {
  final _Section current;
  final ValueChanged<_Section> onPick;
  const _Drawer({required this.current, required this.onPick});

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: T.dSurface,
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(18, 22, 18, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('MNHA · CONSOLE',
                      style: TextStyle(
                          fontSize: 9.5,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w700,
                          color: T.dInk3)),
                  SizedBox(height: 4),
                  Text('Admin',
                      style: TextStyle(
                          fontSize: 19, fontWeight: FontWeight.w700, color: T.dInk)),
                ],
              ),
            ),
            for (final g in _groups.entries) ...[
              if (g.key.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 7),
                  child: Text(g.key,
                      style: const TextStyle(
                          fontSize: 9.5,
                          letterSpacing: 1.1,
                          fontWeight: FontWeight.w700,
                          color: T.dInk3)),
                ),
              for (final s in g.value)
                _Item(s: s, active: s.view == current.view, onPick: onPick),
            ],
            const SizedBox(height: 20),
            const Divider(color: T.dBorder, height: 1),
            const Padding(
              padding: EdgeInsets.fromLTRB(18, 14, 18, 20),
              child: Text(
                'Broker keys are encrypted and never shown here. No order can '
                'be placed from this console.',
                style: TextStyle(fontSize: 11, height: 1.5, color: T.dInk3),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  final _Section s;
  final bool active;
  final ValueChanged<_Section> onPick;
  const _Item({required this.s, required this.active, required this.onPick});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? T.dSurface2 : Colors.transparent,
      child: InkWell(
        onTap: () {
          onPick(s);
          Navigator.of(context).pop();
        },
        child: Row(
          children: [
            // The accent bar on the current page, as on the web.
            Container(width: 3, height: 42, color: active ? T.mark : Colors.transparent),
            const SizedBox(width: 13),
            Icon(s.icon, size: 18, color: active ? T.mark : T.dInk3),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                s.title,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                  color: active ? T.dInk : T.dInk2,
                ),
              ),
            ),
            const SizedBox(width: 12),
          ],
        ),
      ),
    );
  }
}

class _Body extends StatefulWidget {
  final _Section section;
  const _Body({super.key, required this.section});

  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  /// Bumped after a write action. It is part of the [Load] key, so the
  /// section is rebuilt from a fresh request rather than from the data that
  /// was on screen before the action ran — which is the only way the console
  /// can show what the record now actually says.
  int _gen = 0;
  void _reload() => setState(() => _gen++);

  @override
  Widget build(BuildContext context) {
    final view = widget.section.view;
    return Load<Map<String, dynamic>>(
      key: ValueKey('$view-$_gen'),
      load: () => api.admin(view),
      builder: (j) => switch (view) {
        'overview' => _Overview(j),
        'accounts' => _Accounts(j, _reload),
        'members' => _Members(j),
        'kyc' => _Kyc(j, _reload),
        'consents' => _Consents(j),
        'fees' => _Fees(j, _reload),
        'orders' => _OrderLog(j),
        'live' => _Live(j),
        'addresses' => _Addresses(j, _reload),
        'access' => _Access(j),
        'paper' => _Paper(j),
        'report' => _Report(j),
        _ => const Empty(
            icon: Icons.help_outline,
            title: 'Unknown section',
            detail: 'That section does not exist.',
          ),
      },
    );
  }
}

/* ------------------------------------------------------------- dashboard */

class _Overview extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Overview(this.j);

  @override
  Widget build(BuildContext context) {
    final tiles = (j['tiles'] ?? []) as List;
    final attention = (j['attention'] ?? []) as List;
    final funnel = (j['funnel'] ?? []) as List;
    final money = (j['money'] ?? {}) as Map<String, dynamic>;
    final signups = (j['signups'] ?? []) as List;
    final paper = j['paper'];
    final orders = (j['recentOrders'] ?? []) as List;
    final access = (j['recentAccess'] ?? []) as List;

    return ListView(
      padding: const EdgeInsets.only(bottom: 30),
      children: [
        // Six tiles, two per row — the web's six-across grid at phone width.
        const SectionTitle('Today'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 2.0,
            children: [for (final t in tiles) _Tile(t as Map<String, dynamic>)],
          ),
        ),

        const SectionTitle('Needs attention'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: attention.isEmpty
                // The good state, said plainly rather than left blank.
                ? Text(
                    'Nothing waiting on you right now.',
                    style: TextStyle(
                      fontSize: 13,
                      color:
                          Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
                    ),
                  )
                : Column(
                    children: [
                      for (final a in attention)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Row(
                            children: [
                              Container(
                                constraints: const BoxConstraints(minWidth: 30),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 7, vertical: 3),
                                decoration: BoxDecoration(
                                  color: T.warn.withValues(alpha: 0.16),
                                  borderRadius: BorderRadius.circular(3),
                                ),
                                child: Text('${(a as Map)['n']}',
                                    textAlign: TextAlign.center,
                                    style: kNum.copyWith(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w700,
                                        color: T.warn)),
                              ),
                              const SizedBox(width: 11),
                              Expanded(
                                child: Text(
                                  '${a['text']}'
                                  '${a['amount'] == null ? '' : ', ${money2(a['amount'])}'}',
                                  style: const TextStyle(fontSize: 12.5, height: 1.4),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
        ),

        const SectionTitle('Paper trading'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Text(
              paper == null
                  ? 'Research box not connected.'
                  : 'Live research is reporting.',
              style: TextStyle(
                fontSize: 13,
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65),
              ),
            ),
          ),
        ),

        const SectionTitle('Onboarding funnel'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Each step counts only people who passed every earlier step.',
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.45,
                    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                  ),
                ),
                const SizedBox(height: 12),
                for (var i = 0; i < funnel.length; i++)
                  _FunnelRow(
                    step: i + 1,
                    row: funnel[i] as Map<String, dynamic>,
                    top: funnel.isEmpty
                        ? 0
                        : ((funnel.first as Map)['n'] as num).toInt(),
                  ),
              ],
            ),
          ),
        ),

        const SectionTitle('Performance fees'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Fee only on profit above each member\'s previous peak.',
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.45,
                    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                  ),
                ),
                const SizedBox(height: 10),
                for (final r in (money['rows'] ?? []) as List)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${(r as Map)['label']}  (${r['n']})',
                            style: TextStyle(
                              fontSize: 12.5,
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurface
                                  .withValues(alpha: 0.7),
                            ),
                          ),
                        ),
                        Text(
                          money2(r['v']),
                          style: kNum.copyWith(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w600,
                            color: r['tone'] == 'up'
                                ? T.up
                                : r['tone'] == 'down'
                                    ? T.down
                                    : null,
                          ),
                        ),
                      ],
                    ),
                  ),
                const Divider(height: 18),
                Row(
                  children: [
                    for (final k in const ['placed', 'rejected', 'cancelled'])
                      Expanded(
                        child: Column(
                          children: [
                            Text('$k all-time'.toUpperCase(),
                                style: const TextStyle(
                                    fontSize: 8.5,
                                    letterSpacing: 0.6,
                                    fontWeight: FontWeight.w600,
                                    color: T.ink3)),
                            const SizedBox(height: 4),
                            Text('${(money['allTime'] ?? {})[k] ?? 0}',
                                style: kNum.copyWith(
                                    fontSize: 15, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),

        const SectionTitle('Sign-ups, last 14 days'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${signups.fold<int>(0, (a, d) => a + ((d as Map)['n'] as num).toInt())} new accounts',
                  style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 56,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      for (final d in signups)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 1.5),
                            child: _Bar(
                              n: ((d as Map)['n'] as num).toInt(),
                              max: signups.fold<int>(
                                  1,
                                  (m, x) => ((x as Map)['n'] as num).toInt() > m
                                      ? ((x)['n'] as num).toInt()
                                      : m),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),

        const SectionTitle('Latest orders'),
        if (orders.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Panel(
              child: Text('Nothing in the order ledger yet.',
                  style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6))),
            ),
          )
        else
          for (final o in orders) _ledgerRow(context, o as Map<String, dynamic>),

        // The web dashboard carries this card too. It belongs on the front
        // page rather than only in its own section: an admin acting on a
        // client's account is the one thing here nobody should have to go
        // looking for.
        const SectionTitle('Admin access'),
        if (access.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Panel(
              child: Text('No client account opened yet.',
                  style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6))),
            ),
          )
        else
          for (final a in access) _accessLine(context, a as Map<String, dynamic>),
      ],
    );
  }

}

class _Tile extends StatelessWidget {
  final Map<String, dynamic> t;
  const _Tile(this.t);

  @override
  Widget build(BuildContext context) {
    final down = t['tone'] == 'down';
    final isMoney = t['money'] == true;
    return Panel(
      padding: const EdgeInsets.all(11),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('${t['label']}'.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 8.5,
                  letterSpacing: 0.7,
                  fontWeight: FontWeight.w600,
                  color: T.ink3)),
          const SizedBox(height: 5),
          Text(
            isMoney ? money2(t['value']) : '${t['value']}',
            style: kNum.copyWith(
                fontSize: 20, fontWeight: FontWeight.w600, color: down ? T.down : null),
          ),
          const SizedBox(height: 2),
          Text(
            isMoney ? '${money2(t['sub'])} collected' : '${t['sub']}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
                fontSize: 10,
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5)),
          ),
        ],
      ),
    );
  }
}

class _FunnelRow extends StatelessWidget {
  final int step;
  final Map<String, dynamic> row;
  final int top;
  const _FunnelRow({required this.step, required this.row, required this.top});

  @override
  Widget build(BuildContext context) {
    final n = (row['n'] as num).toInt();
    final share = top == 0 ? 0.0 : n / top;
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('$step  ',
                  style: const TextStyle(
                      fontSize: 10.5, fontWeight: FontWeight.w600, color: T.ink3)),
              Expanded(
                child: Text('${row['label']}',
                    style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500)),
              ),
              Text('$n · ${(share * 100).toStringAsFixed(0)}%',
                  style: kNum.copyWith(fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: share.clamp(0, 1),
              minHeight: 4,
              backgroundColor: Theme.of(context).dividerColor.withValues(alpha: 0.5),
              valueColor: const AlwaysStoppedAnimation(T.mark),
            ),
          ),
          if (row['hint'] != null) ...[
            const SizedBox(height: 4),
            Text('${row['hint']}',
                style: TextStyle(
                    fontSize: 10.5,
                    color:
                        Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5))),
          ],
        ],
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  final int n;
  final int max;
  const _Bar({required this.n, required this.max});

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      alignment: Alignment.bottomCenter,
      // A floor of 6% so an empty day is still a visible tick, dimmed —
      // matching the web, where a zero column is drawn at 25% opacity.
      heightFactor: (n / (max == 0 ? 1 : max)).clamp(0.06, 1.0),
      child: Container(
        decoration: BoxDecoration(
          color: T.ink.withValues(alpha: n > 0 ? 0.8 : 0.18),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(2)),
        ),
      ),
    );
  }
}

/* ---------------------------------------------------------------- tables */

/// One line of the order ledger — the web's Order log row.
///
/// The web table has eight columns; a phone gets them stacked. Everything the
/// console records about an order is here, including the Groww order id and
/// the broker's own message, because those two are what a dispute turns on.
Widget _ledgerRow(BuildContext context, Map<String, dynamic> o) => _card(
      context,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _two(
            context,
            '${o['side'] ?? ''} ${o['qty'] ?? ''} ${o['symbol'] ?? ''}'.trim(),
            '${o['who'] ?? o['userId'] ?? ''}',
            right: _pill(
              '${o['status'] ?? '—'}',
              o['status'] == 'placed'
                  ? T.up
                  : o['status'] == 'rejected'
                      ? T.down
                      : o['status'] == 'cancelled'
                          ? T.warn
                          : T.dInk3,
            ),
          ),
          const SizedBox(height: 6),
          _line(context, 'When', fmtStamp((o['at'] as num?)?.toInt())),
          _line(
            context,
            'Order',
            [
              if (o['type'] != null) '${o['type']}',
              if (o['product'] != null) '${o['product']}',
              if (o['segment'] != null) '${o['segment']}',
              if (o['exchange'] != null) '${o['exchange']}',
            ].join(' · '),
          ),
          _line(context, 'Price',
              o['price'] == null ? 'market' : money2(o['price'])),
          if (o['trigger'] != null)
            _line(context, 'Trigger', money2(o['trigger'])),
          // Blank rather than a dash when there is no id: a rejected order
          // never got one, and "—" reads like a value that went missing.
          if (o['orderId'] != null)
            _line(context, 'Groww order id', '${o['orderId']}'),
          if ('${o['message'] ?? ''}'.isNotEmpty)
            _line(context, 'Message', '${o['message']}'),
          if (o['by'] != null && '${o['by']}'.isNotEmpty)
            _line(context, 'Sent by', '${o['by']}'),
        ],
      ),
    );

/// A list section with an honest empty state. Every table below is this
/// shape, so they stay consistent rather than each inventing its own.
class _Table extends StatelessWidget {
  final List rows;
  final String emptyTitle;
  final String emptyDetail;
  final IconData icon;
  final Widget Function(BuildContext, Map<String, dynamic>) row;
  final Widget? header;

  const _Table({
    required this.rows,
    required this.emptyTitle,
    required this.emptyDetail,
    required this.icon,
    required this.row,
    this.header,
  });

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return ListView(
        children: [
          ?header,
          SizedBox(
            height: 360,
            child: Empty(icon: icon, title: emptyTitle, detail: emptyDetail),
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.only(top: 16, bottom: 28),
      children: [
        ?header,
        for (final r in rows) row(context, r as Map<String, dynamic>),
      ],
    );
  }
}

Widget _card(BuildContext context, {required Widget child}) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Panel(padding: const EdgeInsets.all(13), child: child),
    );

Widget _two(BuildContext context, String title, String sub, {Widget? right}) => Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
              if (sub.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(sub,
                    maxLines: 2,
                    style: TextStyle(
                      fontSize: 11,
                      height: 1.4,
                      color:
                          Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                    )),
              ],
            ],
          ),
        ),
        ?right,
      ],
    );

/// A label and its value on one line — the phone's stand-in for a table
/// column. The label is fixed-width so the values line up down the card,
/// which is what makes a column of them scannable at all.
Widget _line(BuildContext context, String label, String value) => Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 74,
            child: Text(label,
                style: const TextStyle(fontSize: 11, color: T.dInk3)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(fontSize: 11.5, color: T.dInk2)),
          ),
        ],
      ),
    );

/// Ask before an act that cannot simply be undone.
///
/// The web console puts these behind a confirm step too. On a phone it
/// matters more: the controls sit under a thumb, and "Delete" is one mis-tap
/// from the row above it.
Future<bool> _confirm(
  BuildContext context, {
  required String title,
  required String body,
  required String confirmLabel,
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: const TextStyle(fontSize: 17)),
      content: Text(body, style: const TextStyle(fontSize: 13.5, height: 1.45)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: Text(confirmLabel,
              style: TextStyle(
                  color: danger ? T.down : T.mark, fontWeight: FontWeight.w600)),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Run a console action, then reload the section.
///
/// The reload is not cosmetic. The server actions decline a request that
/// fails their own checks and say nothing, so the refreshed section is the
/// only honest report of whether anything changed.
Future<void> _act(
  ScaffoldMessengerState messenger,
  VoidCallback reload,
  Map<String, dynamic> body,
) async {
  try {
    await api.adminAction(body);
    reload();
  } on ApiError catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(e.message)));
  } catch (_) {
    messenger.showSnackBar(
      const SnackBar(content: Text('Could not reach the server.')),
    );
  }
}

/// A small outlined control, matching the console's buttons.
Widget _btn(String label, VoidCallback onTap, {Color? tone}) => InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          border: Border.all(color: (tone ?? T.mark).withValues(alpha: 0.5)),
          borderRadius: BorderRadius.circular(3),
        ),
        child: Text(label,
            style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: tone ?? T.mark)),
      ),
    );

Widget _pill(String text, Color c) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Text(text.toUpperCase(),
          style: TextStyle(fontSize: 8.5, fontWeight: FontWeight.w700, color: c)),
    );

class _Accounts extends StatelessWidget {
  final Map<String, dynamic> j;
  final VoidCallback reload;
  const _Accounts(this.j, this.reload);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['accounts'] ?? []) as List,
        icon: Icons.people_outline,
        emptyTitle: 'No accounts',
        emptyDetail: 'Registered accounts appear here.',
        row: (ctx, a) {
          final o = (a['orders'] ?? const {}) as Map;
          final bills = (a['bills'] ?? const {}) as Map;
          final placed = (o['placed'] as num?)?.toInt() ?? 0;
          final rejected = (o['rejected'] as num?)?.toInt() ?? 0;
          final cancelled = (o['cancelled'] as num?)?.toInt() ?? 0;
          final due = (bills['due'] as num?) ?? 0;
          final paid = (bills['paid'] as num?) ?? 0;
          return _card(
            ctx,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _two(ctx, '${a['email']}',
                    'joined ${ago((a['createdAt'] as num?)?.toInt())}'),
                const SizedBox(height: 7),
                // The web Accounts table carries these columns and the app was
                // dropping them. The UCC and the order address are how a row
                // is tied to what the broker and the exchange actually saw,
                // which is the only question asked when an order is disputed.
                _line(ctx, 'User id', '${a['id']}'),
                if (a['hasBroker'] == true) ...[
                  _line(ctx, 'Groww',
                      'connected ${ago((a['brokerConnectedAt'] as num?)?.toInt())}'),
                  _line(ctx, 'UCC', '${a['brokerUcc'] ?? '—'}'),
                  _line(ctx, 'Orders from', '${a['brokerStaticIp'] ?? '—'}'),
                ] else
                  _line(ctx, 'Groww', 'not connected'),
                // Orders counted through MNHA since the ledger started — not
                // the account's whole trading history, which MNHA never saw.
                _line(
                  ctx,
                  'Orders',
                  placed + rejected + cancelled == 0
                      ? 'none sent through MNHA'
                      : '$placed placed'
                          '${rejected > 0 ? ' · $rejected rejected' : ''}'
                          '${cancelled > 0 ? ' · $cancelled cancelled' : ''}',
                ),
                _line(
                  ctx,
                  'Bills',
                  (due == 0 && paid == 0)
                      ? 'none'
                      : '${money2(due)} due · ${money2(paid)} paid',
                ),
                const SizedBox(height: 9),
                Wrap(
                  spacing: 5,
                  runSpacing: 5,
                  children: [
                    _pill(a['hasBroker'] == true ? 'broker' : 'no broker',
                        a['hasBroker'] == true ? T.up : T.dInk3),
                    _pill(
                        a['signedCurrent'] == true
                            ? 'agreement'
                            : a['signedOld'] == true
                                ? 'old agreement'
                                : 'unsigned',
                        a['signedCurrent'] == true
                            ? T.up
                            : a['signedOld'] == true
                                ? T.warn
                                : T.dInk3),
                    _pill('kyc ${a['kyc'] ?? 'none'}',
                        a['kyc'] == 'approved' ? T.up : T.dInk3),
                    _pill('member ${a['membership']}',
                        a['membership'] == 'active' ? T.up : T.dInk3),
                    if (due > 0) _pill('bill due', T.warn),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    if (a['hasBroker'] == true)
                      _btn('Disconnect', () async {
                        final m = ScaffoldMessenger.of(ctx);
                        if (await _confirm(
                          ctx,
                          title: 'Disconnect Groww?',
                          body:
                              'This removes the stored keys for '
                              '${a['email']}. They keep their account and '
                              'their money; they just cannot place an order '
                              'through MNHA until they connect again.',
                          confirmLabel: 'Disconnect',
                        )) {
                          await _act(m, reload, {
                            'action': 'disconnect-broker',
                            'userId': '${a['id']}',
                          });
                        }
                      }),
                    _btn('Delete', () async {
                      final m = ScaffoldMessenger.of(ctx);
                      if (await _confirm(
                        ctx,
                        title: 'Delete this account?',
                        body:
                            'Erases ${a['email']} and their stored data. '
                            'This cannot be undone. Settled bills are kept, '
                            'because they are a financial record.',
                        confirmLabel: 'Delete for good',
                        danger: true,
                      )) {
                        await _act(m, reload, {
                          'action': 'delete-user',
                          'userId': '${a['id']}',
                        });
                      }
                    }, tone: T.down),
                  ],
                ),
              ],
            ),
          );
        },
      );
}

class _Members extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Members(this.j);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['members'] ?? []) as List,
        icon: Icons.star_outline,
        emptyTitle: 'No members',
        emptyDetail:
            'A member is an account enrolled in the performance-fee scheme.',
        row: (ctx, m) {
          final lastNav = m['lastNav'] as num?;
          final hwm = m['highWaterMark'] as num?;
          final feePct = (m['feePct'] as num?) ?? 0;
          final profit =
              (lastNav == null || hwm == null) ? null : lastNav - hwm;
          // A fee estimate is shown only where one is actually owed: on
          // profit ABOVE the high-water mark. Printing a figure below the
          // mark would invent a charge that does not exist.
          final est =
              (profit == null || profit <= 0) ? null : profit * feePct / 100;
          return _card(
            ctx,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _two(
                  ctx,
                  '${m['email']}',
                  'period ends ${ago((m['periodEndsAt'] as num?)?.toInt())}',
                  right: _pill('${m['status']}',
                      m['status'] == 'active' ? T.up : T.dInk3),
                ),
                const SizedBox(height: 6),
                _line(ctx, 'Start', fmtStamp((m['enrolledAt'] as num?)?.toInt())),
                _line(ctx, 'Start NAV', money2(m['startNav'])),
                _line(ctx, 'HWM', money2(hwm)),
                _line(
                  ctx,
                  'Last NAV',
                  lastNav == null
                      ? 'not seen yet'
                      : '${money2(lastNav)}  ·  ${ago((m['lastNavAt'] as num?)?.toInt())}',
                ),
                _line(ctx, 'Profit above HWM',
                    profit == null ? '—' : signed(profit)),
                _line(ctx, 'Fee', '$feePct%'),
                _line(ctx, 'Fee est.', est == null ? 'none owed' : money2(est)),
              ],
            ),
          );
        },
      );
}

class _Kyc extends StatelessWidget {
  final Map<String, dynamic> j;
  final VoidCallback reload;
  const _Kyc(this.j, this.reload);

  Widget _doc(BuildContext ctx, Map k, String kind, String label) => InkWell(
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
          builder: (_) => FileView(
            title: label,
            subtitle: '${k['email'] ?? k['userId']}',
            path: '/api/kyc/file?user=${k['userId']}&kind=$kind',
          ),
        )),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            border: Border.all(color: T.dBorder),
            borderRadius: BorderRadius.circular(3),
          ),
          child: Text(label,
              style: const TextStyle(
                  fontSize: 11.5, fontWeight: FontWeight.w600, color: T.mark)),
        ),
      );

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['records'] ?? []) as List,
        icon: Icons.verified_user_outlined,
        emptyTitle: 'Nothing submitted',
        emptyDetail:
            'Identity documents submitted for review appear here with the '
            'details given.',
        row: (ctx, k) => _card(
          ctx,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _two(
                ctx,
                '${k['fullName'] ?? k['email'] ?? ''}',
                '${k['email'] ?? ''}',
                right: _pill('${k['status']}',
                    k['status'] == 'approved'
                        ? T.up
                        : k['status'] == 'rejected'
                            ? T.down
                            : k['status'] == 'submitted'
                                ? T.warn
                                : T.dInk3),
              ),
              const SizedBox(height: 6),
              _line(ctx, 'Submitted',
                  fmtStamp((k['submittedAt'] as num?)?.toInt())),
              // Masked on the server; the app never receives a full PAN.
              _line(ctx, 'PAN', '${k['panMasked'] ?? '—'}'),
              _line(ctx, 'Date of birth', '${k['dob'] ?? '—'}'),
              _line(ctx, 'Address', '${k['address'] ?? '—'}'),
              if (k['callAt'] != null)
                _line(ctx, 'Call', fmtStamp((k['callAt'] as num?)?.toInt())),
              if ('${k['callLink'] ?? ''}'.isNotEmpty)
                _line(ctx, 'Meeting', '${k['callLink']}'),
              if (k['hasSelfie'] == true || k['hasDoc'] == true) ...[
                const SizedBox(height: 9),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    if (k['hasSelfie'] == true) _doc(ctx, k, 'selfie', 'Selfie'),
                    if (k['hasDoc'] == true) _doc(ctx, k, 'doc', 'Document'),
                  ],
                ),
              ],
              const SizedBox(height: 10),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  _btn('Set call', () => _setCall(ctx, reload, '${k['userId']}')),
                  _btn('Approve', () async {
                    final m = ScaffoldMessenger.of(ctx);
                    if (await _confirm(
                      ctx,
                      title: 'Approve this identity?',
                      body:
                          'Confirms ${k['fullName'] ?? k['email']} is '
                          'verified, and tells them so.',
                      confirmLabel: 'Approve',
                    )) {
                      await _act(m, reload, {
                        'action': 'kyc-decision',
                        'userId': '${k['userId']}',
                        'decision': 'approved',
                      });
                    }
                  }, tone: T.up),
                  _btn('Reject',
                      () => _reject(ctx, reload, '${k['userId']}'),
                      tone: T.down),
                ],
              ),
            ],
          ),
        ),
      );
}

class _Consents extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Consents(this.j);

  /// The media URL the web console links to.
  ///
  /// The version is appended only when the record is NOT the current
  /// agreement — exactly as `vq()` does on the web. It matters: without it a
  /// re-signing would serve the newest photos against an older signature, so
  /// the audit row would show a document that was never part of what was
  /// actually signed.
  String _media(Map x, String kind) {
    final v = '${x['agreementVersion']}';
    final q = v == '${j['agreementVersion']}' ? '' : '&v=${Uri.encodeComponent(v)}';
    return '/api/consent/media?user=${x['userId']}&kind=$kind$q';
  }

  /// The web's Consents column, verbatim: the four required consents are
  /// either all present or the row says so, then the optional ones as they
  /// stand NOW (`current` once changed, otherwise as signed).
  String _summary(Map x) {
    final signed = x['consents'] as Map?;
    if (signed == null) return '— (pre-v3)';
    final now = (x['current'] as Map?) ?? signed;
    const required = ['account', 'identity', 'groww', 'risk'];
    final parts = <String>[
      required.every((k) => signed[k] == true) ? '4/4 required' : 'required missing',
      'mkt ${now['marketing'] == true ? 'on' : 'off'}',
      'analytics ${now['analytics'] == true ? 'on' : 'off'}',
    ];
    if (now['groww'] != true) parts.add('Groww withdrawn');
    final n = (x['changes'] as List?)?.length ?? 0;
    if (n > 0) parts.add('$n change${n > 1 ? 's' : ''}');
    return parts.join(' · ');
  }

  Widget _doc(BuildContext ctx, Map x, String kind, String label) => InkWell(
        onTap: () => Navigator.of(ctx).push(MaterialPageRoute(
          builder: (_) => FileView(
            title: label,
            subtitle: '${x['email']}',
            path: _media(x, kind),
          ),
        )),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            border: Border.all(color: T.dBorder),
            borderRadius: BorderRadius.circular(3),
          ),
          child: Text(label,
              style: const TextStyle(
                  fontSize: 11.5, fontWeight: FontWeight.w600, color: T.mark)),
        ),
      );

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['consents'] ?? []) as List,
        icon: Icons.description_outlined,
        emptyTitle: 'No consents recorded',
        emptyDetail: 'A signed agreement is recorded here with its version.',
        row: (ctx, x) {
          final media = (x['media'] ?? const {}) as Map;
          final liveness = media['liveness'] == true;
          return _card(
            ctx,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _two(
                  ctx,
                  // The signature is the name the user typed to sign. It is
                  // the identifying column on the web, so it leads here too.
                  '${x['signatureName'] ?? x['email']}',
                  '${x['email']}',
                  right: _pill('v${x['agreementVersion']}',
                      '${x['agreementVersion']}' == '${j['agreementVersion']}'
                          ? T.up
                          : T.warn),
                ),
                const SizedBox(height: 8),
                // `consentedAt` is the field the record actually carries. An
                // earlier version of this screen read `at`, which does not
                // exist on a ConsentRecord, so every row said "signed never"
                // while the website showed the real date against the same
                // data. A missing timestamp now reads as unknown, not never.
                _line(ctx, 'Signed',
                    '${fmtStamp((x['consentedAt'] as num?)?.toInt())}'
                    '  ·  ${ago((x['consentedAt'] as num?)?.toInt())}'),
                _line(
                    ctx,
                    'Language',
                    x['language'] == null
                        ? '—'
                        : '${'${x['language']}'.toUpperCase()} · ${x['agreementVersion']}'),
                _line(ctx, 'Consents', _summary(x)),
                _line(ctx, 'IP', '${x['ip'] ?? '—'}'),
                if (media['selfie'] == true ||
                    media['idPhoto'] == true ||
                    media['video'] == true) ...[
                  const SizedBox(height: 9),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (media['selfie'] == true) _doc(ctx, x, 'selfie', 'Selfie'),
                      if (media['selfie'] == true)
                        Text(liveness ? '✓ blink' : 'no blink check',
                            style: TextStyle(
                                fontSize: 11,
                                color: liveness ? T.up : T.dInk3)),
                      if (media['idPhoto'] == true)
                        _doc(ctx, x, 'id', 'PAN / Aadhaar'),
                      if (media['video'] == true) _doc(ctx, x, 'video', 'Video'),
                    ],
                  ),
                ],
              ],
            ),
          );
        },
      );
}

class _Fees extends StatelessWidget {
  final Map<String, dynamic> j;
  final VoidCallback reload;
  const _Fees(this.j, this.reload);

  @override
  Widget build(BuildContext context) {
    final t = (j['totals'] ?? const {}) as Map<String, dynamic>;
    return _Table(
      rows: (j['invoices'] ?? []) as List,
      icon: Icons.currency_rupee,
      emptyTitle: 'No invoices',
      emptyDetail:
          'A bill is raised when a member period is settled. Fee is charged '
          'only on profit above the high-water mark.',
      header: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _line(context, 'Billed', money2(t['billed'])),
              _line(context, 'Paid', money2(t['paid'])),
              _line(context, 'Due', money2(t['due'])),
              _line(context, 'Waived', money2(t['waived'])),
            ],
          ),
        ),
      ),
      row: (ctx, iv) => _card(
        ctx,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _two(
              ctx,
              '${iv['email']}',
              'fee ${iv['feePct'] ?? '—'}%',
              right: _pill('${iv['status']}',
                  iv['status'] == 'paid'
                      ? T.up
                      : iv['status'] == 'due'
                          ? T.warn
                          : T.dInk3),
            ),
            const SizedBox(height: 6),
            _line(
              ctx,
              'Period',
              '${fmtStamp((iv['periodStart'] as num?)?.toInt())}'
                  '  to  ${fmtStamp((iv['periodEnd'] as num?)?.toInt())}',
            ),
            _line(ctx, 'HWM before', money2(iv['hwmBefore'])),
            _line(ctx, 'End NAV', money2(iv['endNav'])),
            _line(ctx, 'Profit above HWM', money2(iv['profitAboveHwm'])),
            _line(ctx, 'Fee due', money2(iv['feeDue'])),
            if (iv['settledAt'] != null)
              _line(ctx, 'Settled',
                  fmtStamp((iv['settledAt'] as num?)?.toInt())),
            if ('${iv['note'] ?? ''}'.isNotEmpty)
              _line(ctx, 'Note', '${iv['note']}'),
            // Only a bill still due can be marked: the server refuses the
            // rest, so offering the control would promise something it will
            // not do.
            if (iv['status'] == 'due') ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  _btn('Mark paid', () async {
                    final m = ScaffoldMessenger.of(ctx);
                    if (await _confirm(
                      ctx,
                      title: 'Mark this bill paid?',
                      body:
                          'Records ${money2(iv['feeDue'])} as received from '
                          '${iv['email']} and tells them so.',
                      confirmLabel: 'Mark paid',
                    )) {
                      await _act(m, reload, {
                        'action': 'mark-invoice',
                        'id': '${iv['id']}',
                        'status': 'paid',
                      });
                    }
                  }),
                  _btn('Waive', () async {
                    final m = ScaffoldMessenger.of(ctx);
                    if (await _confirm(
                      ctx,
                      title: 'Waive this fee?',
                      body:
                          'Closes the bill for ${iv['email']} without taking '
                          '${money2(iv['feeDue'])}.',
                      confirmLabel: 'Waive',
                    )) {
                      await _act(m, reload, {
                        'action': 'mark-invoice',
                        'id': '${iv['id']}',
                        'status': 'waived',
                      });
                    }
                  }, tone: T.dInk2),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OrderLog extends StatelessWidget {
  final Map<String, dynamic> j;
  const _OrderLog(this.j);

  @override
  Widget build(BuildContext context) {
    final t = (j['today'] ?? {}) as Map<String, dynamic>;
    return _Table(
      rows: (j['orders'] ?? []) as List,
      icon: Icons.receipt_long_outlined,
      emptyTitle: 'Order ledger empty',
      emptyDetail: 'Every order routed through the desk is recorded here.',
      header: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Panel(
          child: Row(
            children: [
              for (final k in const ['placed', 'rejected', 'cancelled'])
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('$k today'.toUpperCase(),
                          style: const TextStyle(
                              fontSize: 8.5,
                              letterSpacing: 0.6,
                              fontWeight: FontWeight.w600,
                              color: T.ink3)),
                      const SizedBox(height: 3),
                      Text('${t[k] ?? 0}',
                          style: kNum.copyWith(
                              fontSize: 15, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      row: (ctx, o) => _ledgerRow(ctx, o),
    );
  }
}

class _Addresses extends StatelessWidget {
  final Map<String, dynamic> j;
  final VoidCallback reload;
  const _Addresses(this.j, this.reload);

  @override
  Widget build(BuildContext context) {
    final pool = (j['pool'] ?? const []) as List;
    final house = j['house'];
    final accounts = (j['accounts'] ?? const []) as List;

    // Who currently holds an address, by matching the member's order address
    // — the same join the web table makes.
    String? holder(String? ip) {
      if (ip == null) return null;
      for (final a in accounts) {
        if ('${(a as Map)['ip']}' == ip) return '${a['email']}';
      }
      return null;
    }

    Widget entry(String ip, String reachedBy, String? note, {bool built = false}) {
      final who = holder(ip);
      return _card(
        context,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _two(context, ip, reachedBy,
                right: who == null
                    ? _pill('free', T.up)
                    : _pill(built ? 'built in' : 'in use', T.dInk3)),
            if (note != null && note.isNotEmpty) ...[
              const SizedBox(height: 4),
              _line(context, 'Note', note),
            ],
            const SizedBox(height: 4),
            _line(context, 'Held by', who ?? 'nobody'),
            // An address in use is never removable here: taking it away from
            // a connected member would break their orders, so the web offers
            // no control either.
            if (who == null && !built) ...[
              const SizedBox(height: 9),
              _btn('Remove', () async {
                final m = ScaffoldMessenger.of(context);
                if (await _confirm(
                  context,
                  title: 'Remove this address?',
                  body:
                      '$ip leaves the pool. Nobody holds it, so no member is '
                      'affected, but one fewer client can be connected.',
                  confirmLabel: 'Remove',
                )) {
                  await _act(m, reload, {'action': 'remove-address', 'ip': ip});
                }
              }, tone: T.dInk2),
            ],
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.only(top: 16, bottom: 28),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Text(
            'An exchange ties one registered address to one Groww account, so '
            'each member needs their own. A new sign-up is handed the first '
            'address nobody holds.',
            style: TextStyle(
                fontSize: 12,
                height: 1.45,
                color: Theme.of(context)
                    .colorScheme
                    .onSurface
                    .withValues(alpha: 0.6)),
          ),
        ),
        if (house != null) entry('$house', 'This server', null, built: true),
        for (final e in pool)
          entry(
            '${(e as Map)['ip']}',
            e['proxy'] == null || '${e['proxy']}'.isEmpty
                ? 'Bound on this server'
                : 'Tunnel ${e['proxy']}',
            e['note'] == null ? null : '${e['note']}',
          ),
        if (house == null && pool.isEmpty)
          const SizedBox(
            height: 320,
            child: Empty(
              icon: Icons.place_outlined,
              title: 'No order addresses',
              detail:
                  'Without a registered address a member cannot be connected, '
                  'and the connect page tells them to call.',
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Align(
            alignment: Alignment.centerLeft,
            child: _btn('Add address', () => _addAddress(context, reload)),
          ),
        ),
      ],
    );
  }
}

class _Access extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Access(this.j);

  /// The web console's wording for each kind of access, and its tone.
  ///
  /// Acts done FOR the client — connecting their broker, sending or
  /// cancelling an order — are called out, because they are not the same
  /// thing as an admin merely looking at an account.
  static const _event = <String, String>{
    'open': 'Opened',
    'close': 'Back to admin',
    'connect-broker': 'Connected Groww for the client',
    'order': 'Sent an order for the client',
    'cancel': 'Sent a cancellation for the client',
  };
  static const _loud = {'connect-broker', 'order', 'cancel'};

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['entries'] ?? []) as List,
        icon: Icons.history,
        emptyTitle: 'No access logged',
        emptyDetail:
            'Every time an admin opens a client account it is recorded here, '
            'with who and when.',
        row: (ctx, e) {
          // The record's field is `kind`. This read `action`, which a record
          // has never carried, and the `?? 'opened'` fallback buried it:
          // EVERY row rendered as "opened", so an admin placing an order for
          // a client looked identical to one glancing at the account. That is
          // the single distinction this log exists to draw.
          final kind = '${e['kind'] ?? ''}';
          final detail = '${e['detail'] ?? ''}';
          return _card(
            ctx,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _two(
                  ctx,
                  _event[kind] ?? (kind.isEmpty ? 'Accessed' : kind),
                  '${e['email'] ?? e['userId'] ?? ''}',
                  right: Text(
                    ago((e['at'] as num?)?.toInt()),
                    style: TextStyle(
                        fontSize: 10.5,
                        color: Theme.of(ctx)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.45)),
                  ),
                ),
                if (_loud.contains(kind)) ...[
                  const SizedBox(height: 7),
                  _pill('acted for the client', T.warn),
                ],
                const SizedBox(height: 5),
                _line(ctx, 'When', fmtStamp((e['at'] as num?)?.toInt())),
                _line(ctx, 'Admin IP', '${e['ip'] ?? '—'}'),
                if (detail.isNotEmpty) _line(ctx, 'Detail', detail),
              ],
            ),
          );
        },
      );
}

class _Paper extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Paper(this.j);

  /// A figure with its caption, two to a row.
  Widget _stat(BuildContext ctx, String label, String value, {Color? tone}) =>
      Expanded(
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(),
                  style: const TextStyle(
                      fontSize: 9.5,
                      letterSpacing: 0.8,
                      fontWeight: FontWeight.w600,
                      color: T.dInk3)),
              const SizedBox(height: 6),
              Text(value,
                  style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: tone ?? Theme.of(ctx).colorScheme.onSurface)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final live = j['live'] as Map?;
    final kind = '${live?['kind'] ?? ''}';

    // The three states the research box can be in are kept apart on purpose.
    // "Not configured" is a deployment fact, "unreachable" is a fault worth
    // chasing, and neither may be dressed up as a quiet day with no trades.
    if (live == null || kind != 'ok') {
      return ListView(
        children: [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.cloud_off_outlined,
              title: kind == 'unconfigured'
                  ? 'Research box not configured'
                  : 'Research box not reachable',
              detail: kind == 'error'
                  ? '${live?['message'] ?? 'The research host did not answer.'}'
                  : 'Paper trading runs on a separate research host. When it '
                      'cannot be reached the console says so, rather than '
                      'showing a stale report as though it were today\'s.',
            ),
          ),
        ],
      );
    }

    final data = (live['data'] ?? const {}) as Map;
    final r = data['livex'] as Map?;
    final sl05 = data['sl05'] as Map?;
    final book = data['book'] as num?;

    if (r == null) {
      return ListView(
        children: [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.science_outlined,
              title: 'No paper sessions yet',
              detail: '${data['livex_error'] ?? 'The first pick is stored at 09:20 on the next trading day.'}',
            ),
          ),
        ],
      );
    }

    final today = r['today'] as Map?;
    final mark = r['mark'] as Map?;
    final sessions = (r['sessions'] as Map?)?.length ?? 0;
    final winRate = r['day_win_rate'] as num?;
    final perMonth = (r['per_month_pct'] ?? const {}) as Map;
    final months = perMonth.keys.map((k) => '$k').toList()..sort();

    return ListView(
      padding: const EdgeInsets.only(top: 14, bottom: 28),
      children: [
        if (today != null) ...[
          const SectionTitle('Live now'),
          _card(
            context,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _two(context, '${today['pick'] ?? 'no pick'}',
                    'status ${today['status'] ?? '—'}',
                    right: today['skip'] != null
                        ? _pill('skipped', T.dInk3)
                        : _pill('${today['status'] ?? ''}', T.up)),
                const SizedBox(height: 6),
                if (today['flip_symbol'] != null)
                  _line(context, 'Flip', '${today['flip_symbol']}'),
                if (mark != null) ...[
                  _line(context, 'Running P&L', signed(mark['running_net'] as num?)),
                  _line(context, 'Market move', pct(mark['mkt_move'] as num?)),
                  _line(context, 'Marked at',
                      fmtStamp(((mark['at'] as num?)?.toInt() ?? 0) * 1000)),
                  _line(context, 'Quotes used', '${mark['n_quotes'] ?? '—'}'),
                ],
              ],
            ),
          ),
        ],

        const SectionTitle('Book A'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              Row(children: [
                _stat(context, 'Net so far', signed(r['net_rs'] as num?),
                    tone: ((r['net_rs'] as num?) ?? 0) >= 0 ? T.up : T.down),
                const SizedBox(width: 8),
                _stat(context, 'Of book', pct(r['pct_of_book'] as num?)),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _stat(context, 'Sessions', '$sessions'),
                const SizedBox(width: 8),
                _stat(context, 'Winning days',
                    winRate == null ? '—' : '${(winRate * 100).toStringAsFixed(0)}%'),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _stat(context, 'Worst day', signed(r['worst_day_rs'] as num?),
                    tone: T.down),
                const SizedBox(width: 8),
                // Named as the web does: the drop from the running peak, not
                // a loss against the starting book.
                _stat(context, 'Largest fall', signed(r['max_fall_rs'] as num?),
                    tone: T.down),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _stat(context, 'Skipped days', '${r['skip_days'] ?? 0}'),
                const SizedBox(width: 8),
                _stat(context, 'Flip days', '${r['flip_days'] ?? 0}'),
              ]),
            ],
          ),
        ),

        if (sl05 != null) ...[
          const SectionTitle('Book B  ·  fixed 0.5% stop'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(children: [
              _stat(context, 'Net', signed(sl05['net_rs'] as num?),
                  tone: ((sl05['net_rs'] as num?) ?? 0) >= 0 ? T.up : T.down),
              const SizedBox(width: 8),
              // A plain share, not a signed one: pct() prints "+27.00%",
              // which reads as a gain when it is the portion of trades that
              // hit the stop.
              _stat(
                  context,
                  'Stopped out',
                  sl05['stopped_out_share'] == null
                      ? '—'
                      : '${(((sl05['stopped_out_share'] as num) * 100)).toStringAsFixed(0)}%'),
            ]),
          ),
        ],

        if (months.isNotEmpty) ...[
          const SectionTitle('By month'),
          for (final m in months.reversed)
            _card(
              context,
              child: _two(context, m, 'book A',
                  right: Text(pct(perMonth[m] as num?),
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: ((perMonth[m] as num?) ?? 0) >= 0
                              ? T.up
                              : T.down))),
            ),
        ],

        if (book != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: Text('Book size ${money2(book)}.',
                style: const TextStyle(fontSize: 11, color: T.dInk3)),
          ),

        const Padding(
          padding: EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Text(
            'Paper trading only — no order was placed and no money moved. The '
            'day-by-day legs are under Daily report.',
            style: TextStyle(fontSize: 11, height: 1.5, color: T.dInk3),
          ),
        ),
      ],
    );
  }
}


/// One admin-access line for the dashboard card.
Widget _accessLine(BuildContext context, Map<String, dynamic> e) {
  final kind = '${e['kind'] ?? ''}';
  final loud = _Access._loud.contains(kind);
  return _card(
    context,
    child: _two(
      context,
      _Access._event[kind] ?? (kind.isEmpty ? 'Accessed' : kind),
      '${e['email'] ?? e['userId'] ?? ''}  ·  ${e['ip'] ?? ''}',
      right: loud
          ? _pill('for the client', T.warn)
          : Text(
              ago((e['at'] as num?)?.toInt()),
              style: TextStyle(
                  fontSize: 10.5,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.45)),
            ),
    ),
  );
}

/// Reject an identity submission, with the note the client is sent.
///
/// The note is the whole point: "not approved" with no reason leaves someone
/// unable to fix whatever was wrong, so the web asks for one and so does this.
Future<void> _reject(
    BuildContext context, VoidCallback reload, String userId) async {
  final messenger = ScaffoldMessenger.of(context);
  final notes = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title:
          const Text('Reject this submission?', style: TextStyle(fontSize: 17)),
      content: TextField(
        controller: notes,
        maxLines: 3,
        decoration: const InputDecoration(
          labelText: 'What should they fix?',
          hintText: 'Sent to the client with the decision.',
        ),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel')),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('Reject',
              style: TextStyle(color: T.down, fontWeight: FontWeight.w600)),
        ),
      ],
    ),
  );
  if (ok == true) {
    await _act(messenger, reload, {
      'action': 'kyc-decision',
      'userId': userId,
      'decision': 'rejected',
      'notes': notes.text.trim(),
    });
  }
  notes.dispose();
}

/// Schedule the identity video call.
Future<void> _setCall(
    BuildContext context, VoidCallback reload, String userId) async {
  final messenger = ScaffoldMessenger.of(context);
  final day = await showDatePicker(
    context: context,
    firstDate: DateTime.now().subtract(const Duration(days: 1)),
    lastDate: DateTime.now().add(const Duration(days: 365)),
    initialDate: DateTime.now(),
  );
  if (day == null || !context.mounted) return;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.now(),
  );
  if (time == null || !context.mounted) return;

  final link = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Meeting link', style: TextStyle(fontSize: 17)),
      content: TextField(
        controller: link,
        decoration: const InputDecoration(hintText: 'https://…'),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel')),
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Set call',
                style: TextStyle(fontWeight: FontWeight.w600))),
      ],
    ),
  );
  if (ok == true) {
    final at = DateTime(day.year, day.month, day.day, time.hour, time.minute);
    await _act(messenger, reload, {
      'action': 'kyc-call',
      'userId': userId,
      // The server parses this with Date(); an ISO string with no zone is
      // read in the server's own zone, which is where the call is booked.
      'callAt': at.toIso8601String(),
      'callLink': link.text.trim(),
    });
  }
  link.dispose();
}

/// Add an order address to the pool.
Future<void> _addAddress(BuildContext context, VoidCallback reload) async {
  final messenger = ScaffoldMessenger.of(context);
  final ip = TextEditingController();
  final proxy = TextEditingController();
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Add an order address', style: TextStyle(fontSize: 17)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: ip,
            decoration: const InputDecoration(
                labelText: 'Address', hintText: '72.60.30.154'),
          ),
          TextField(
            controller: proxy,
            decoration: const InputDecoration(
                labelText: 'Tunnel (if another host owns it)',
                hintText: 'http://72.60.30.154:8888'),
          ),
          TextField(
            controller: note,
            decoration: const InputDecoration(
                labelText: 'Note', hintText: 'where it came from'),
          ),
        ],
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel')),
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Add',
                style: TextStyle(fontWeight: FontWeight.w600))),
      ],
    ),
  );
  if (ok == true && ip.text.trim().isNotEmpty) {
    await _act(messenger, reload, {
      'action': 'add-address',
      'ip': ip.text.trim(),
      'proxy': proxy.text.trim(),
      'note': note.text.trim(),
    });
  }
  for (final c in [ip, proxy, note]) {
    c.dispose();
  }
}
