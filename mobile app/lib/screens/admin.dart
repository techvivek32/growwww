import 'package:flutter/material.dart';
import '../api/client.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'login.dart';
import 'shell.dart';

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
    _Section('addresses', 'Order addresses', Icons.place_outlined),
    _Section('orders', 'Order log', Icons.receipt_long_outlined),
    _Section('fees', 'Fee ledger', Icons.currency_rupee),
  ],
  'RESEARCH': [
    _Section('paper', 'Paper trading', Icons.trending_up),
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

class _Body extends StatelessWidget {
  final _Section section;
  const _Body({super.key, required this.section});

  @override
  Widget build(BuildContext context) {
    return Load<Map<String, dynamic>>(
      load: () => api.admin(section.view),
      builder: (j) => switch (section.view) {
        'overview' => _Overview(j),
        'accounts' => _Accounts(j),
        'members' => _Members(j),
        'kyc' => _Kyc(j),
        'consents' => _Consents(j),
        'fees' => _Fees(j),
        'orders' => _OrderLog(j),
        'addresses' => _Addresses(j),
        'access' => _Access(j),
        'paper' => _Paper(j),
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

Widget _ledgerRow(BuildContext context, Map<String, dynamic> o) => Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 7),
      child: Panel(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${o['symbol'] ?? o['id'] ?? '—'}',
                      style:
                          const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 3),
                  Text(
                    '${o['side'] ?? ''} ${o['qty'] ?? ''}  ·  ${o['who'] ?? o['userId'] ?? ''}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color:
                          Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (o['status'] != null)
                  Text('${o['status']}'.toUpperCase(),
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: '${o['status']}' == 'rejected' ? T.down : T.ink3,
                      )),
                const SizedBox(height: 3),
                Text(ago((o['at'] as num?)?.toInt()),
                    style: TextStyle(
                        fontSize: 10.5,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.45))),
              ],
            ),
          ],
        ),
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
  const _Accounts(this.j);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['accounts'] ?? []) as List,
        icon: Icons.people_outline,
        emptyTitle: 'No accounts',
        emptyDetail: 'Registered accounts appear here.',
        row: (ctx, a) => _card(
          ctx,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _two(ctx, '${a['email']}', 'joined ${ago((a['createdAt'] as num?)?.toInt())}'),
              const SizedBox(height: 9),
              Wrap(
                spacing: 5,
                runSpacing: 5,
                children: [
                  _pill(a['hasBroker'] == true ? 'broker' : 'no broker',
                      a['hasBroker'] == true ? T.up : T.ink3),
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
                              : T.ink3),
                  _pill('kyc ${a['kyc'] ?? 'none'}',
                      a['kyc'] == 'approved' ? T.up : T.ink3),
                  _pill('member ${a['membership']}',
                      a['membership'] == 'active' ? T.up : T.ink3),
                ],
              ),
            ],
          ),
        ),
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
        row: (ctx, m) => _card(
          ctx,
          child: _two(
            ctx,
            '${m['email']}',
            'fee ${((m['feePct'] as num?) ?? 0)}%  ·  period ends '
                '${ago((m['periodEndsAt'] as num?)?.toInt())}',
            right: _pill('${m['status']}', m['status'] == 'active' ? T.up : T.ink3),
          ),
        ),
      );
}

class _Kyc extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Kyc(this.j);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['records'] ?? []) as List,
        icon: Icons.verified_user_outlined,
        emptyTitle: 'Nothing submitted',
        emptyDetail:
            'Identity documents are reviewed on the website, where the '
            'document is large enough to actually read.',
        row: (ctx, k) => _card(
          ctx,
          child: _two(
            ctx,
            '${k['email']}',
            'submitted ${ago((k['submittedAt'] as num?)?.toInt())}',
            right: _pill('${k['status']}',
                k['status'] == 'approved'
                    ? T.up
                    : k['status'] == 'submitted'
                        ? T.warn
                        : T.ink3),
          ),
        ),
      );
}

class _Consents extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Consents(this.j);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['consents'] ?? []) as List,
        icon: Icons.description_outlined,
        emptyTitle: 'No consents recorded',
        emptyDetail: 'A signed agreement is recorded here with its version.',
        row: (ctx, x) => _card(
          ctx,
          child: _two(
            ctx,
            '${x['email']}',
            'signed ${ago((x['at'] as num?)?.toInt())}',
            right: _pill('v${x['agreementVersion']}',
                '${x['agreementVersion']}' == '${j['agreementVersion']}' ? T.up : T.warn),
          ),
        ),
      );
}

class _Fees extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Fees(this.j);

  @override
  Widget build(BuildContext context) {
    final t = (j['totals'] ?? {}) as Map<String, dynamic>;
    return _Table(
      rows: (j['invoices'] ?? []) as List,
      icon: Icons.currency_rupee,
      emptyTitle: 'No invoices',
      emptyDetail:
          'A period settles into an invoice only when NAV finished above the '
          'high-water mark. Nothing is ever charged on a loss.',
      header: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Panel(
          child: Row(
            children: [
              for (final k in const ['billed', 'paid', 'due', 'waived'])
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(k.toUpperCase(),
                          style: const TextStyle(
                              fontSize: 8.5,
                              letterSpacing: 0.6,
                              fontWeight: FontWeight.w600,
                              color: T.ink3)),
                      const SizedBox(height: 3),
                      Text(moneyCompact((t[k] as num?)?.toDouble()),
                          style: kNum.copyWith(
                              fontSize: 13, fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      row: (ctx, v) => _card(
        ctx,
        child: _two(
          ctx,
          '${v['email']}',
          'profit ${money2(v['profitAboveHwm'])}  ·  fee ${money2(v['feeDue'])}',
          right: _pill('${v['status']}',
              v['status'] == 'paid'
                  ? T.up
                  : v['status'] == 'due'
                      ? T.warn
                      : T.ink3),
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
  const _Addresses(this.j);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['accounts'] ?? []) as List,
        icon: Icons.place_outlined,
        emptyTitle: 'No connected accounts',
        emptyDetail:
            'Each connected account sends its orders from one registered '
            'address. A mismatch gets the order refused by the broker.',
        header: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
          child: Panel(
            child: Row(
              children: [
                Expanded(
                  child: Text('House address',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.65),
                      )),
                ),
                Text('${j['house'] ?? '—'}',
                    style: kNum.copyWith(fontSize: 12.5, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ),
        row: (ctx, a) => _card(
          ctx,
          child: _two(ctx, '${a['email']}',
              'UCC ${a['ucc'] ?? '—'}',
              right: Text('${a['ip'] ?? 'no address'}',
                  style: kNum.copyWith(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: a['ip'] == null ? T.down : null))),
        ),
      );
}

class _Access extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Access(this.j);

  @override
  Widget build(BuildContext context) => _Table(
        rows: (j['entries'] ?? []) as List,
        icon: Icons.history,
        emptyTitle: 'No access logged',
        emptyDetail:
            'Every time an admin opens a client account it is recorded here, '
            'with who and when.',
        row: (ctx, e) => _card(
          ctx,
          child: _two(
            ctx,
            '${e['action'] ?? 'opened'}  ${e['email'] ?? ''}',
            '${e['ip'] ?? ''}',
            right: Text(ago((e['at'] as num?)?.toInt()),
                style: TextStyle(
                    fontSize: 10.5,
                    color:
                        Theme.of(ctx).colorScheme.onSurface.withValues(alpha: 0.45))),
          ),
        ),
      );
}

class _Paper extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Paper(this.j);

  @override
  Widget build(BuildContext context) {
    if (j['live'] == null) {
      return ListView(
        children: const [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.cloud_off_outlined,
              title: 'Research box not connected',
              detail:
                  'Paper trading runs on a separate research host. When it is '
                  'not reachable the console says so rather than showing a '
                  'stale report as though it were today\'s.',
            ),
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        Panel(
          child: Text(
            'Live research is reporting. The full day report stays on the '
            'website, where the table is readable.',
            style: TextStyle(
              fontSize: 13,
              height: 1.5,
              color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
        ),
      ],
    );
  }
}
