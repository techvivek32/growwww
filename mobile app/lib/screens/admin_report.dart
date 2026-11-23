part of 'admin.dart';

/// One trading day of the paper record, leg by leg — the web's
/// `/admin/paper/report`.
///
/// The website renders this as a printable A4 landscape sheet. A phone cannot
/// show that table without either scrolling sideways forever or shrinking the
/// figures past reading, so every leg becomes its own stacked block here and
/// the printable sheet stays on the web. The figures are identical: both read
/// the same stored record from the research box, and neither recomputes a
/// thing.
///
/// A `part` of admin.dart rather than its own library because it builds on
/// the same card, pill and line helpers the rest of the console uses — a
/// second set of them would drift away from the first.
class _Report extends StatelessWidget {
  final Map<String, dynamic> j;
  const _Report(this.j);

  /// Book A fills at the CLOSE of a five-minute bar: bar 0 closes at 09:20.
  static String _barTime(num? b) {
    if (b == null) return '—';
    final m = 9 * 60 + 20 + 5 * b.toInt();
    return '${(m ~/ 60).toString().padLeft(2, '0')}'
        ':${(m % 60).toString().padLeft(2, '0')}';
  }

  /// The exit reasons the record stores as codes, in the website's wording.
  static const _why = <int, String>{
    0: '15:15 square-off',
    1: 'stop',
    5: 'market stop',
    6: 'covered at 10:15 flip',
  };

  static String _status(Map d) {
    if (d['status'] == 'no_session') return 'Holiday — no session.';
    if (d['skip'] != null) {
      return 'Skipped — the regime filter kept the book flat today.';
    }
    if (d['status'] == 'settled') return 'Settled at 15:15.';
    return 'Session in progress — figures below are as stored so far.';
  }

  static Color _tone(num? net) => ((net ?? 0) >= 0) ? T.up : T.down;

  Widget _legA(BuildContext ctx, Map t) => _card(
        ctx,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _two(
              ctx,
              '${t['symbol']}',
              '${t['leg'] == 'flip_long' ? 'flip long' : 'short'}'
                  '  ·  qty ${t['qty']}',
              right: Text(
                signed(t['net'] as num?),
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: _tone(t['net'] as num?)),
              ),
            ),
            const SizedBox(height: 6),
            _line(ctx, 'Entry',
                '${money2(t['entry'])}  at ${_barTime(t['entry_bar'] as num?)}'),
            _line(ctx, 'Exit',
                '${money2(t['exit'])}  at ${_barTime(t['exit_bar'] as num?)}'),
            _line(ctx, 'Why', _why[(t['why'] as num?)?.toInt() ?? -1] ?? '—'),
            _line(ctx, 'Gross', money2(t['gross'])),
            _line(ctx, 'Charges', money2(t['costs'])),
          ],
        ),
      );

  Widget _legB(BuildContext ctx, Map t) {
    // A leg of a running session has no net yet. Showing it as 0 would read as
    // "broke even", which is a result — so it is marked open instead.
    final open = t['open'] == true;
    return _card(
      ctx,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _two(
            ctx,
            '${t['symbol']}',
            '${t['leg']}  ·  qty ${t['qty'] ?? '—'}',
            right: open
                ? _pill('open', T.warn)
                : Text(
                    signed(t['net'] as num?),
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: _tone(t['net'] as num?)),
                  ),
          ),
          const SizedBox(height: 6),
          _line(ctx, 'Entry', money2(t['entry'])),
          _line(ctx, 'Exit', t['exit'] == null ? 'still open' : money2(t['exit'])),
          _line(ctx, 'Why', '${t['why'] ?? '—'}'),
          if (t['costs'] != null) _line(ctx, 'Charges', money2(t['costs'])),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (j['ok'] != true) {
      return ListView(
        children: [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.cloud_off_outlined,
              title: 'No report to show',
              // The server's own wording, not a generic message: "not
              // configured" and "unreachable" call for different action from
              // whoever is reading this.
              detail: '${j['reason'] ?? 'No paper record yet.'}',
            ),
          ),
        ],
      );
    }

    final d = (j['day'] ?? const {}) as Map;
    final a = (j['bookA'] ?? const {}) as Map;
    final b = (j['bookB'] ?? const {}) as Map;
    final legsA = (a['legs'] ?? const []) as List;
    final legsB = (b['legs'] ?? const []) as List;
    final monthPct = j['monthPct'] as num?;

    return ListView(
      padding: const EdgeInsets.fromLTRB(0, 14, 0, 28),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${d['iso']}',
                      style: const TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w600,
                          color: T.dInk),
                    ),
                  ),
                  if (d['isToday'] == true) _pill('today', T.mark),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                _status(d),
                style: const TextStyle(
                    fontSize: 12.5, color: T.dInk3, height: 1.4),
              ),
              if (d['pick'] != null) ...[
                const SizedBox(height: 7),
                _line(context, 'Pick', '${d['pick']}'),
                if (d['flipSymbol'] != null)
                  _line(context, 'Flip', '${d['flipSymbol']}'),
              ],
              if (monthPct != null) _line(context, 'Month', pct(monthPct)),
            ],
          ),
        ),

        SectionTitle('Book A  ·  net ${signed(a['net'] as num?)}'),
        if (a['served'] != true)
          _card(
            context,
            child: const Text(
              'Legs for this day are outside the window the research box '
              'serves. The day is in the record; its legs are not.',
              style: TextStyle(fontSize: 12, color: T.dInk3, height: 1.4),
            ),
          )
        else if (legsA.isEmpty)
          _card(
            context,
            child: const Text('No legs — the book stayed flat.',
                style: TextStyle(fontSize: 12, color: T.dInk3)),
          )
        else ...[
          for (final t in legsA) _legA(context, t as Map),
          _card(
            context,
            child: _two(
              context,
              'Charges for the day',
              'brokerage, taxes and fees',
              right: Text(money2(a['costs']),
                  style: const TextStyle(fontSize: 13, color: T.dInk2)),
            ),
          ),
        ],

        SectionTitle(
          'Book B  ·  net ${signed(b['net'] as num?)}',
          trailing: ((b['openLegs'] as num?) ?? 0) > 0
              ? _pill('${b['openLegs']} open', T.warn)
              : null,
        ),
        if (b['served'] != true)
          _card(
            context,
            child: const Text(
              'Legs for this day are outside the window the research box '
              'serves.',
              style: TextStyle(fontSize: 12, color: T.dInk3, height: 1.4),
            ),
          )
        else if (legsB.isEmpty)
          _card(
            context,
            child: const Text('No legs recorded for book B.',
                style: TextStyle(fontSize: 12, color: T.dInk3)),
          )
        else
          for (final t in legsB) _legB(context, t as Map),

        const Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, 0),
          child: Text(
            'Paper trading only. No order was placed and no money moved. Past '
            'paper results are not a promise of future returns.',
            style: TextStyle(fontSize: 11, color: T.dInk3, height: 1.5),
          ),
        ),
      ],
    );
  }
}
