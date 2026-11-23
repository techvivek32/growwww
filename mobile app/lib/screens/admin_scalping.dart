part of 'admin.dart';

/// The scalping research program — the web's `/admin/scalping`.
///
/// A search over short-hold rules, and the daily paper results of the 100 it
/// chose. Read-only: nothing here places anything, and the rules are a
/// research output, not a running strategy.
///
/// The selection window and the test months are kept apart everywhere they
/// appear, and labelled. That separation is the entire statistical point: a
/// rule is CHOSEN on the selection window, so its number there is the one it
/// was picked for and says nothing about whether it works. Only the test
/// months, which came after the choosing, carry evidence. Showing a single
/// blended "return" is how a search gets read as a result.
class _Scalping extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Scalping(this.j);

  Widget _stat(BuildContext ctx, String label, String value, String sub,
          {Color? tone}) =>
      Expanded(
        child: Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(),
                  style: const TextStyle(
                      fontSize: 9,
                      letterSpacing: 0.7,
                      fontWeight: FontWeight.w600,
                      color: T.dInk3)),
              const SizedBox(height: 5),
              Text(value,
                  style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: tone ?? Theme.of(ctx).colorScheme.onSurface)),
              const SizedBox(height: 2),
              Text(sub,
                  style: const TextStyle(
                      fontSize: 10, height: 1.3, color: T.dInk3)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (j['ok'] != true) {
      return ListView(
        children: [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.cloud_off_outlined,
              title: 'Scalping research not available',
              detail: '${j['reason'] ?? 'The research box did not answer.'}',
            ),
          ),
        ],
      );
    }

    final status = j['status'] as String?;
    final search = j['search'] as Map?;
    final top = (j['top'] ?? const []) as List;
    final daily = (j['daily'] ?? const []) as List;
    final live = j['live'] as Map?;

    if (search == null) {
      return ListView(
        children: [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.science_outlined,
              title: 'No search yet',
              detail: status ?? 'The first search has not produced a result.',
            ),
          ),
        ],
      );
    }

    final q = (search['selection_per_month_pct_quantiles'] ?? const {}) as Map;
    final median = (q['0.5'] as num?) ?? 0;
    final test = (search['test_summary'] ?? const {}) as Map;
    final testMean = (test['top100_mean_per_month_pct_test'] as num?) ?? 0;
    final testShare = (test['top100_share_positive_in_test'] as num?) ?? 0;
    final profitablePct = (search['profitable_in_selection_pct'] as num?) ?? 0;

    return ListView(
      padding: const EdgeInsets.only(top: 14, bottom: 28),
      children: [
        if (live != null) ..._liveBook(context, live),

        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            children: [
              Row(children: [
                _stat(context, 'Strategies searched',
                    '${search['strategies'] ?? '—'}', '${search['panel'] ?? ''}'),
                const SizedBox(width: 8),
                _stat(
                  context,
                  'Profitable in selection',
                  '$profitablePct%',
                  '${search['profitable_in_selection'] ?? 0} of ${search['strategies'] ?? 0}',
                  tone: profitablePct > 50 ? T.up : T.down,
                ),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _stat(context, 'Median strategy', pct(median),
                    'per month, selection window',
                    tone: median >= 0 ? T.up : T.down),
                const SizedBox(width: 8),
                // The one number with evidence in it: these months came AFTER
                // the hundred were chosen.
                _stat(
                  context,
                  'Top 100 in the test months',
                  pct(testMean),
                  '${(testShare * 100).round()}% positive after selection',
                  tone: testMean >= 0 ? T.up : T.down,
                ),
              ]),
              const SizedBox(height: 8),
              Row(children: [
                _stat(
                  context,
                  'Paper days',
                  '${daily.length}',
                  daily.isEmpty
                      ? 'from the next session'
                      : 'latest ${(daily.last as Map)['day']}: avg '
                          '${money2((daily.last as Map)['mean_net_rs'])}',
                ),
                const SizedBox(width: 8),
                const Expanded(child: SizedBox()),
              ]),
            ],
          ),
        ),

        if (daily.isNotEmpty) ...[
          const SectionTitle('Daily paper results of the 100'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              "Each session, the 100 strategies run on that day's bars. "
              'Average net, how many were positive, best and worst.',
              style: TextStyle(
                  fontSize: 11.5,
                  height: 1.45,
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.6)),
            ),
          ),
          // Newest first: on a phone the latest session is what is being
          // looked for, and scrolling to the bottom to find it is a chore.
          for (final d in daily.reversed)
            _card(
              context,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _two(
                    context,
                    '${(d as Map)['day']}',
                    '${d['positive'] ?? 0} of 100 positive',
                    right: Text(
                      signed(d['mean_net_rs'] as num?),
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: ((d['mean_net_rs'] as num?) ?? 0) >= 0
                              ? T.up
                              : T.down),
                    ),
                  ),
                  const SizedBox(height: 5),
                  _line(
                      context,
                      'Best',
                      '#${(d['best'] as Map?)?['rank'] ?? '—'}  '
                          '${signed((d['best'] as Map?)?['net_rs'] as num?)}'),
                  _line(
                      context,
                      'Worst',
                      '#${(d['worst'] as Map?)?['rank'] ?? '—'}  '
                          '${signed((d['worst'] as Map?)?['net_rs'] as num?)}'),
                ],
              ),
            ),
        ],

        if (top.isNotEmpty) ...[
          const SectionTitle('The 100 chosen strategies'),
          for (final t in top)
            _card(
              context,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _two(
                    context,
                    '#${(t as Map)['rank']}  ${t['signal']}',
                    '${t['side']}  ·  ${t['universe']}  ·  ${t['window']}',
                    right: _pill('${t['side']}',
                        t['side'] == 'long' ? T.up : T.down),
                  ),
                  const SizedBox(height: 6),
                  _line(
                      context,
                      'Stop / target / hold',
                      '${t['stop_pct']}%  /  ${t['target_pct']}%  /  '
                          '${t['max_hold_min']} min'),
                  _line(context, 'Trades a day', '${t['trades_per_day'] ?? '—'}'),
                  // Labelled, always. The selection figure is the one it was
                  // chosen on; the test figure is the one that means anything.
                  _line(
                      context,
                      'Selection /mo',
                      pct((t['selection_2024_01_to_2026_04']
                          as Map?)?['per_month_pct'] as num?)),
                  _line(
                      context,
                      'Test /mo',
                      pct((t['test_2026_05_on'] as Map?)?['per_month_pct']
                          as num?)),
                  _line(
                      context,
                      'Test net',
                      signed((t['test_2026_05_on'] as Map?)?['net_rs'] as num?)),
                  if (t['paper'] != null)
                    _line(
                        context,
                        'Paper',
                        '${(t['paper'] as Map)['days']} days  ·  '
                            '${signed((t['paper'] as Map)['net_rs'] as num?)}  ·  '
                            '${(t['paper'] as Map)['positive_days']} positive'),
                ],
              ),
            ),
        ],

        const Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Text(
            'Research only. These rules are searched and paper-tested; nothing '
            'here places an order. A rule is chosen on the selection window, '
            'so only the test months say whether it held up.',
            style: TextStyle(fontSize: 11, height: 1.5, color: T.dInk3),
          ),
        ),
      ],
    );
  }
}



/// Today's live scalp book — paper positions under the 11:00-11:15 window and
/// the trail rule.
///
/// Stated, not implied: the window, the trail and how many rules are in play
/// all appear, because the figures below them mean nothing without those
/// three. And "paper" is said out loud — no order is placed by any of this.
List<Widget> _liveBook(BuildContext context, Map live) {
  final today = live['today'] as Map?;
  final sum = (today?['summary'] ?? const {}) as Map;
  final positions = (today?['positions'] ?? const []) as List;
  final rules = (live['rules'] ?? const []) as List;
  final trail = (live['trail_rs'] as num?) ?? 1000;
  final covered =
      rules.fold<int>(0, (n, r) => n + (((r as Map)['ranks'] ?? const []) as List).length);

  Color tone(String st) => switch (st) {
        'open' => T.up,
        'closed' => T.dInk3,
        'waiting' => T.warn,
        _ => T.dInk3,
      };

  return [
    const SectionTitle('Live scalp book  ·  paper'),
    Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Text(
        'Entries only at the ${live['window'] ?? '11:05, 11:10, 11:15 bar closes'}; '
        'one position per rule, the most liquid stock firing. Exit when '
        '${money2(trail)} below the position\'s best point, or at 15:15. '
        '${rules.length} rules from the $covered strategies that were positive '
        'on 20 Nov. No orders are placed.',
        style: TextStyle(
            fontSize: 11.5,
            height: 1.45,
            color:
                Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6)),
      ),
    ),
    if (live['error'] != null)
      _card(context,
          child: Text('${live['error']}',
              style: const TextStyle(fontSize: 12, color: T.down))),
    if (today == null)
      _card(context,
          child: Text('Nothing yet — the book starts at 10:58 IST.',
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
            _two(context, '${today['day']}', 'status ${today['status'] ?? '—'}',
                right: _pill('${today['status'] ?? ''}',
                    today['status'] == 'done' ? T.dInk3 : T.up)),
            const SizedBox(height: 6),
            // Realised and unrealised are kept apart. Only the first has
            // actually happened, even on paper.
            _line(context, 'Today, total', signed(sum['total_rs'] as num?)),
            _line(context, 'Realised', signed(sum['realised_rs'] as num?)),
            _line(context, 'Unrealised', signed(sum['unrealised_rs'] as num?)),
            _line(context, 'Open / closed',
                '${sum['open'] ?? 0} open · ${sum['closed'] ?? 0} closed'),
            _line(context, 'No signal',
                '${sum['no_signal'] ?? 0} rules did not fire in the window'),
            if (today['updated_at'] != null)
              _line(context, 'Updated',
                  ago(((today['updated_at'] as num).toInt()) * 1000)),
          ],
        ),
      ),
      for (final p in positions)
        _card(
          context,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _two(
                context,
                '${(p as Map)['symbol'] ?? 'no signal'}',
                '#${p['rule']}  ${p['signal']}  ·  ${p['side']}',
                right: _pill('${p['status']}', tone('${p['status']}')),
              ),
              const SizedBox(height: 5),
              if (p['entry'] != null)
                _line(context, 'Entry',
                    '${money2(p['entry'])}${p['entry_bar'] == null ? '' : '  at ${p['entry_bar']}'}'
                    '${p['qty'] == null ? '' : '  ·  ${p['qty']}'}'),
              if (p['status'] == 'open') ...[
                _line(context, 'LTP', money2(p['ltp'])),
                _line(context, 'Running', signed(p['pnl_rs'] as num?)),
                // The trail is measured from the best point, so the peak is
                // what decides the exit — not the current mark.
                _line(context, 'Best so far', signed(p['peak_rs'] as num?)),
              ],
              if (p['status'] == 'closed') ...[
                _line(context, 'Exit', money2(p['exit'])),
                _line(context, 'Why', '${p['why'] ?? '—'}'),
                if (p['cost_rs'] != null)
                  _line(context, 'Charges', money2(p['cost_rs'])),
                _line(context, 'Net', signed(p['net_rs'] as num?)),
              ],
            ],
          ),
        ),
    ],
    const SizedBox(height: 6),
  ];
}
