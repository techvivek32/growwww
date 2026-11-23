part of 'admin.dart';

/// The live-trading console, as a read — the web's `/admin/live`.
///
/// The website's page also places orders, sends one order to many accounts,
/// exits positions and cancels working orders. None of that is here, and that
/// is deliberate rather than unfinished: those move real money in clients'
/// accounts, and this app's standing rule is that orders leave from the desk.
///
/// What an admin actually needs from a phone is to SEE it: whether the loop is
/// still ticking, which accounts are eligible, what went out today and how it
/// ended. A console that cannot be watched away from the desk is the reason
/// someone finds out about a stalled strategy an hour late.
class _Live extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Live(this.j);

  static const _groupLabel = <String, String>{
    'eligible': 'Eligible',
    'low': 'Low balance',
    'blocked': 'Cannot trade',
    'excluded': 'Kept out',
  };

  static Color _stateTone(String s) => switch (s) {
        'placed' => T.up,
        'rejected' || 'refused' => T.down,
        'unknown' || 'sending' => T.warn,
        _ => T.dInk3,
      };

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
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: tone ?? Theme.of(ctx).colorScheme.onSurface)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final settings = (j['settings'] ?? const {}) as Map;
    final executor = (j['executor'] ?? const {}) as Map;
    final day = j['day'] as Map?;
    final accounts = (j['accounts'] ?? const {}) as Map;
    final rows = (accounts['rows'] ?? const []) as List;
    final orders = (j['orders'] ?? const []) as List;
    final changes = (j['changes'] ?? const []) as List;
    final positions = (j['positions'] ?? const []) as List;

    final mode = '${settings['mode'] ?? '—'}';
    final stalled = executor['stalled'] == true;
    final started = executor['started'] == true;

    return ListView(
      padding: const EdgeInsets.only(top: 14, bottom: 28),
      children: [
        // The loop's health leads, because everything below is meaningless if
        // nothing is running to produce it.
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        !started
                            ? 'Executor not started'
                            : stalled
                                ? 'Executor stalled'
                                : 'Executor running',
                        style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: !started
                                ? T.dInk3
                                : stalled
                                    ? T.down
                                    : T.up),
                      ),
                    ),
                    // off / shadow / live are three different facts. "off"
                    // is the default now, and must not read like a fault.
                    _pill(
                        mode == 'off' ? 'switched off' : mode,
                        mode == 'live'
                            ? T.mark
                            : mode == 'shadow'
                                ? T.warn
                                : T.dInk3),
                  ],
                ),
                const SizedBox(height: 6),
                _line(context, 'Last tick',
                    ago((executor['lastTickAt'] as num?)?.toInt())),
                _line(context, 'Started',
                    ago((executor['startedAt'] as num?)?.toInt())),
                if (executor['lastError'] != null)
                  _line(context, 'Last error', '${executor['lastError']}'),
                _line(context, 'Base value', money2(settings['base'])),
                if ((settings['excluded'] as num?) != null &&
                    (settings['excluded'] as num) > 0)
                  _line(context, 'Kept out', '${settings['excluded']} account(s)'),
              ],
            ),
          ),
        ),

        SectionTitle('Today'),
        if (day == null)
          _card(context,
              child: Text('Nothing fixed for today yet.',
                  style: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6))))
        else ...[
          _card(
            context,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _two(context, '${day['date']}',
                    day['accounts'] == null
                        ? 'accounts not fixed yet'
                        : '${day['accounts']} account(s) trading',
                    right: day['fixedAt'] == null
                        ? _pill('not fixed', T.dInk3)
                        : _pill('fixed', T.up)),
                const SizedBox(height: 6),
                _line(context, 'Base each', money2(day['base'])),
                if (day['fixedAt'] != null)
                  _line(context, 'Fixed at',
                      fmtStamp((day['fixedAt'] as num?)?.toInt())),
                if ((day['signals'] as Map?)?['skip'] == true)
                  _line(context, 'Signal', 'skip day — no trade today'),
              ],
            ),
          ),
          // The day's four steps in the order they run, each saying whether it
          // has finished. The page leads with this now, and it is the thing an
          // admin away from the desk actually wants: not a count of accounts,
          // but whether 09:20 went out and whether 15:15 has closed.
          for (final st in _steps(day)) _step(context, st),
        ],

        SectionTitle('Accounts'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              Row(children: [
                _stat(context, 'Eligible', '${accounts['eligible'] ?? 0}',
                    tone: T.up),
                const SizedBox(width: 8),
                _stat(context, 'Low balance', '${accounts['low'] ?? 0}',
                    tone: T.warn),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _stat(context, 'Cannot trade', '${accounts['blocked'] ?? 0}',
                    tone: T.down),
                const SizedBox(width: 8),
                _stat(context, 'Kept out', '${accounts['excluded'] ?? 0}'),
              ]),
            ],
          ),
        ),
        if (rows.isEmpty)
          _card(context,
              child: Text('No account has Groww connected.',
                  style: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6))))
        else
          for (final a in rows)
            _card(
              context,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _two(context, '${(a as Map)['label']}',
                      _groupLabel['${a['group']}'] ?? '${a['group']}',
                      right: _pill(
                          '${a['group']}',
                          a['group'] == 'eligible'
                              ? T.up
                              : a['group'] == 'blocked'
                                  ? T.down
                                  : T.warn)),
                  // The reason an account cannot trade is the whole value of
                  // this row; without it the admin only learns that something
                  // is wrong, not what to fix.
                  if (a['reason'] != null) ...[
                    const SizedBox(height: 5),
                    _line(context, 'Why', '${a['reason']}'),
                  ],
                  if (a['funds'] != null)
                    _line(context, 'Free', money2((a['funds'] as Map)['free'])),
                  if (a['agreement'] != null)
                    _line(context, 'Agreement', '${a['agreement']}'),
                ],
              ),
            ),

        SectionTitle('Open positions'),
        if (positions.isEmpty)
          _card(context,
              child: Text('Nothing open, or no account can be read.',
                  style: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6))))
        else
          for (final p in positions)
            _card(
              context,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _two(
                    context,
                    '${(p as Map)['label']}',
                    // The reading's age is part of the reading. The web polls
                    // every 2 s; a phone does not, so the time it was taken
                    // travels with it rather than being implied.
                    p['at'] == null
                        ? 'never read'
                        : 'read ${ago((p['at'] as num?)?.toInt())}',
                    right: p['error'] != null
                        ? _pill('stale', T.down)
                        : p['canExit'] == true
                            ? _pill('can exit', T.up)
                            : _pill('cannot exit', T.dInk3),
                  ),
                  if (p['error'] != null) ...[
                    const SizedBox(height: 5),
                    _line(context, 'Last read failed', '${p['error']}'),
                  ],
                  const SizedBox(height: 4),
                  if (((p['rows'] ?? const []) as List).isEmpty)
                    _line(context, 'Open', 'nothing')
                  else
                    for (final r in (p['rows'] as List))
                      _line(
                        context,
                        '${(r as Map)['symbol']}',
                        '${r['side'] ?? ''} ${r['qty']}'
                            '${r['avg'] == null ? '' : '  @ ${money2(r['avg'])}'}'
                            '${r['skip'] == null ? '' : '  · ${r['skip']}'}',
                      ),
                ],
              ),
            ),

        SectionTitle("Today's orders"),
        if (orders.isEmpty)
          _card(context,
              child: Text('No orders today.',
                  style: TextStyle(
                      fontSize: 12.5,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6))))
        else
          for (final o in orders)
            _card(
              context,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _two(
                    context,
                    '${(o as Map)['side'] ?? ''} ${o['qty'] ?? ''} ${o['symbol'] ?? ''}'
                        .trim(),
                    '${o['who'] ?? ''}',
                    right: _pill('${o['state'] ?? '—'}',
                        _stateTone('${o['state'] ?? ''}')),
                  ),
                  const SizedBox(height: 6),
                  _line(context, 'Step', '${o['actionLabel'] ?? o['action']}'),
                  _line(context, 'When', fmtStamp((o['at'] as num?)?.toInt())),
                  _line(
                      context,
                      'Order',
                      [
                        if (o['type'] != null) '${o['type']}',
                        if (o['product'] != null) '${o['product']}',
                        if (o['segment'] != null) '${o['segment']}',
                      ].join(' · ')),
                  _line(context, 'Price',
                      o['price'] == null ? 'market' : money2(o['price'])),
                  if (o['filled'] != null)
                    _line(context, 'Filled', '${o['filled']}'),
                  // Shadow orders were never sent anywhere. Saying so beside
                  // the row keeps a dry run from being read as a real fill.
                  if (o['mode'] == 'shadow')
                    _line(context, 'Mode', 'shadow — nothing was sent'),
                  if (o['growwOrderId'] != null)
                    _line(context, 'Groww', '${o['growwOrderId']}'),
                  if ('${o['message'] ?? ''}'.isNotEmpty)
                    _line(context, 'Message', '${o['message']}'),
                ],
              ),
            ),

        if (changes.isNotEmpty) ...[
          SectionTitle('Changes'),
          for (final c in changes)
            _card(
              context,
              child: _two(context, '${(c as Map)['what']}', '${c['ip'] ?? ''}',
                  right: Text(ago((c['at'] as num?)?.toInt()),
                      style: const TextStyle(fontSize: 10.5, color: T.dInk3))),
            ),
        ],

        const Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Text(
            'Read-only here. Placing an order, sending one to many accounts, '
            'exiting a position and cancelling a working order all stay on the '
            'website — they move real money in clients\' accounts, and orders '
            'leave from the desk.',
            style: TextStyle(fontSize: 11, height: 1.5, color: T.dInk3),
          ),
        ),
      ],
    );
  }
}

/// One of today's four steps, as the page lists them.
class _LiveStep {
  final String time;
  final String title;
  final bool done;
  final String value;
  const _LiveStep(this.time, this.title, this.done, this.value);
}

/// The day's steps in running order, with what each one did.
///
/// Mirrors the page's wording. A step that has not run yet says what it is
/// waiting for rather than showing a blank, because "nothing here" and "not
/// yet" are different states and only one of them is a problem.
List<_LiveStep> _steps(Map day) {
  final done = (day['done'] ?? const {}) as Map;
  final legs = (day['legs'] ?? const {}) as Map;
  final skip = (day['signals'] as Map?)?['skip'] == true;
  final short = legs['short'] as Map?;
  final long = legs['long'] as Map?;

  String shortLine() {
    if (skip) return 'Skip day — no trade today';
    if (done['entry'] != null) {
      return short == null
          ? 'No trade (see alerts)'
          : 'Sold ${short['qty']} ${short['symbol']}';
    }
    return 'Waiting for 09:20';
  }

  return [
    _LiveStep('09:20', 'Sell (short)', done['entry'] != null, shortLine()),
    _LiveStep(
      'Stop',
      'If the market rises 0.5%, buy back',
      done['stop'] != null,
      done['stop'] != null ? 'Bought back' : 'Not triggered',
    ),
    _LiveStep(
      '10:15',
      'Flip',
      done['flip'] != null,
      done['flip'] != null
          ? (long == null
              ? 'Covered, no long'
              : 'Bought ${long['qty']} ${long['symbol']}')
          : done['flipCover'] != null
              ? 'Short covered, long not placed'
              : 'Not flipped',
    ),
    _LiveStep(
      '15:15',
      'Close everything',
      done['close'] != null,
      done['close'] != null ? 'Closed' : 'Not closed yet',
    ),
  ];
}

Widget _step(BuildContext context, _LiveStep st) => _card(
      context,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 54,
            child: Text(st.time,
                style: const TextStyle(
                    fontSize: 11, fontWeight: FontWeight.w600, color: T.dInk3)),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(st.title,
                    style: const TextStyle(
                        fontSize: 13.5, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(st.value,
                    style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.6),
                    )),
              ],
            ),
          ),
          Icon(
            st.done ? Icons.check_circle : Icons.circle_outlined,
            size: 17,
            color: st.done ? T.up : T.dInk3,
          ),
        ],
      ),
    );
