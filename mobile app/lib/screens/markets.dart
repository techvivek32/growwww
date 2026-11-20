import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// Markets — the index strip, and the rule-based setups on the owner's
/// account. The phone equivalent of the web's ticker strip plus /stocks/alerts.
class MarketsScreen extends StatelessWidget {
  final Me me;
  /// Opens the shell's navigation drawer. Null when this screen is pushed
  /// rather than shown as a bottom-bar destination.
  final VoidCallback? onMenu;
  const MarketsScreen({super.key, required this.me, this.onMenu});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Markets'),
        leading: onMenu == null
            ? null
            : IconButton(icon: const Icon(Icons.menu), onPressed: onMenu),
        actions: [_MarketPill(me.market), const SizedBox(width: 12)],
      ),
      body: Load<({List<Quote> quotes, MarketState market})>(
        load: api.indices,
        builder: (data) => ListView(
          padding: const EdgeInsets.only(bottom: 28),
          children: [
            const SectionTitle('Indices'),
            for (final q in data.quotes)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: _IndexCard(q),
              ),
            if (me.isOwner) const _Alerts(),
          ],
        ),
      ),
    );
  }
}

/// Market phase, live-dot and clock — the web header's session indicator.
class _MarketPill extends StatelessWidget {
  final MarketState m;
  const _MarketPill(this.m);

  @override
  Widget build(BuildContext context) {
    final live = m.isLive;
    return Row(
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(
            color: live ? T.up : T.ink3,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 7),
        Text(
          m.label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
          ),
        ),
      ],
    );
  }
}

class _IndexCard extends StatelessWidget {
  final Quote q;
  const _IndexCard(this.q);

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final c = T.move(q.changePct, dark: dark);
    return Panel(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        q.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                    if (q.stale) ...[const SizedBox(width: 8), StaleTag(asOf: q.asOf)],
                  ],
                ),
                const SizedBox(height: 7),
                Text(
                  num_(q.last),
                  style: kNum.copyWith(fontSize: 19, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 3),
                Text(
                  '${q.change >= 0 ? '+' : ''}${num_(q.change)}   ${pct(q.changePct)}',
                  style: kNum.copyWith(fontSize: 12.5, color: c, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          ),
          if (q.spark.length > 1) Spark(q.spark, color: c),
        ],
      ),
    );
  }
}

/// Owner-only setups. The server enforces this too (403 from the route); the
/// client check is just to avoid a request that is certain to be refused.
class _Alerts extends StatelessWidget {
  const _Alerts();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<StockAlert>>(
      future: api.alerts(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(28),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        if (snap.hasError) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
            child: Panel(
              child: Text(
                snap.error is ApiError
                    ? (snap.error as ApiError).message
                    : 'Could not load setups.',
                style: TextStyle(
                  fontSize: 13,
                  color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
            ),
          );
        }
        final alerts = snap.data ?? [];
        if (alerts.isEmpty) {
          return const Padding(
            padding: EdgeInsets.fromLTRB(16, 20, 16, 0),
            child: Panel(
              child: Text(
                'No setups qualify right now. Scores come from the day\'s real '
                'range, volume against its 20-session average, and the 30-day '
                'close series — when nothing clears the bar, nothing is shown.',
                style: TextStyle(fontSize: 13, height: 1.5),
              ),
            ),
          );
        }
        return Column(
          children: [
            SectionTitle('Setups', trailing: Text(
              '${alerts.length}',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5),
              ),
            )),
            for (final a in alerts)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
                child: _AlertCard(a),
              ),
          ],
        );
      },
    );
  }
}

class _AlertCard extends StatelessWidget {
  final StockAlert a;
  const _AlertCard(this.a);

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final c = T.move(a.changePct, dark: dark);
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(a.symbol,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(
                      a.company,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: T.mark.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(2),
                ),
                child: Text(
                  'SCORE ${a.score.toStringAsFixed(0)}',
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: T.mark,
                    letterSpacing: 0.4,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Text(num_(a.last),
                  style: kNum.copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
              const SizedBox(width: 10),
              Text(pct(a.changePct),
                  style: kNum.copyWith(fontSize: 13, color: c, fontWeight: FontWeight.w500)),
              const Spacer(),
              if (a.spark.length > 1) Spark(a.spark, color: c, size: const Size(52, 20)),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 11),
          // Entry / target / stop — the three numbers that make a setup
          // actionable. R/R alongside, because a target without its risk is
          // only half the trade.
          Row(
            children: [
              _leg('Entry', num_(a.entry), null),
              _leg('Target', num_(a.target), T.up),
              _leg('Stop', num_(a.stop), T.down),
              _leg('R/R', '${a.rr.toStringAsFixed(1)}×', null),
            ],
          ),
          if (a.tags.isNotEmpty) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final t in a.tags)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      border: Border.all(color: Theme.of(context).dividerColor),
                      borderRadius: BorderRadius.circular(2),
                    ),
                    child: Text(
                      t,
                      style: TextStyle(
                        fontSize: 10.5,
                        color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _leg(String label, String value, Color? color) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontSize: 9,
                letterSpacing: 0.7,
                fontWeight: FontWeight.w600,
                color: T.ink3,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: kNum.copyWith(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      );
}
