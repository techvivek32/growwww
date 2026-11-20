import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// Portfolio analytics — the web's `/portfolio/analysis`.
class AnalysisScreen extends StatelessWidget {
  const AnalysisScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      appBar: AppBar(title: const Text('Analysis')),
      body: Load<Analysis>(
        load: api.analysis,
        builder: (a) {
          if (!a.connected) {
            return ListView(
              children: const [
                SizedBox(
                  height: 420,
                  child: Empty(
                    icon: Icons.link_off,
                    title: 'No broker connected',
                    detail:
                        'Allocation and performance are computed from your Groww '
                        'holdings and trades. Connect a broker on the website to '
                        'see them here.',
                  ),
                ),
              ],
            );
          }

          final missing = a.holdingsCount - a.pricedCount;

          return ListView(
            padding: const EdgeInsets.only(bottom: 28),
            children: [
              const SectionTitle('Position'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Panel(
                  child: Column(
                    children: [
                      Row(
                        children: [
                          _stat(context, 'Invested', moneyCompact(a.invested)),
                          _stat(context, 'Current', moneyCompact(a.current)),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          _stat(
                            context,
                            'Unrealised',
                            signed(a.unrealised),
                            color: T.move(a.unrealised, dark: dark),
                          ),
                          _stat(
                            context,
                            'Return',
                            pct(a.unrealisedPct),
                            color: T.move(a.unrealisedPct, dark: dark),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              // Said out loud rather than silently folded into the totals: a
              // missing price counted as zero understates allocation in a way
              // that looks like rounding.
              if (missing > 0)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  child: Text(
                    '$missing of ${a.holdingsCount} holdings had no live price and '
                    '${missing == 1 ? 'is' : 'are'} excluded from these figures.',
                    style: const TextStyle(fontSize: 11.5, color: T.warn, height: 1.45),
                  ),
                ),

              const SectionTitle('Realised'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Panel(
                  child: Column(
                    children: [
                      Row(
                        children: [
                          _stat(
                            context,
                            'Net (gross)',
                            signed(a.realisedGross),
                            color: T.move(a.realisedGross, dark: dark),
                          ),
                          _stat(
                            context,
                            'Win rate',
                            a.winRate == null
                                ? '—'
                                : '${a.winRate!.toStringAsFixed(0)}%  ·  ${a.wins}/${a.tradeCount}',
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Gross — Groww\'s order payload carries no per-trade '
                          'charges, and an account-level figure split across '
                          'trades would be a guess.',
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.45,
                            color: Theme.of(context)
                                .colorScheme
                                .onSurface
                                .withValues(alpha: 0.5),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              SectionTitle(
                'Allocation',
                trailing: a.topWeightPct == null
                    ? null
                    : Text(
                        'top ${a.topWeightPct!.toStringAsFixed(1)}%',
                        style: TextStyle(
                          fontSize: 11,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.5),
                        ),
                      ),
              ),
              if (a.allocation.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Panel(
                    child: Text(
                      'Nothing with a live price to allocate.',
                      style: TextStyle(
                        fontSize: 13,
                        color:
                            Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
                      ),
                    ),
                  ),
                )
              else
                for (final r in a.allocation)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Panel(
                      padding: const EdgeInsets.all(13),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  r.symbol,
                                  style: const TextStyle(
                                      fontSize: 14, fontWeight: FontWeight.w700),
                                ),
                              ),
                              Text(
                                '${r.pct.toStringAsFixed(1)}%',
                                style: kNum.copyWith(
                                    fontSize: 13, fontWeight: FontWeight.w600),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          // A weight bar reads faster than the number alone,
                          // which is the point of this screen.
                          ClipRRect(
                            borderRadius: BorderRadius.circular(2),
                            child: LinearProgressIndicator(
                              value: (r.pct / 100).clamp(0, 1),
                              minHeight: 5,
                              backgroundColor:
                                  Theme.of(context).dividerColor.withValues(alpha: 0.5),
                              valueColor: const AlwaysStoppedAnimation(T.mark),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  moneyCompact(r.value),
                                  style: kNum.copyWith(
                                    fontSize: 11.5,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .onSurface
                                        .withValues(alpha: 0.6),
                                  ),
                                ),
                              ),
                              Text(
                                signed(r.pnl),
                                style: kNum.copyWith(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w500,
                                  color: T.move(r.pnl, dark: dark),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }

  Widget _stat(BuildContext context, String label, String value, {Color? color}) =>
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontSize: 9.5,
                letterSpacing: 0.7,
                fontWeight: FontWeight.w600,
                color: T.ink3,
              ),
            ),
            const SizedBox(height: 5),
            Text(value,
                style: kNum.copyWith(
                    fontSize: 16, fontWeight: FontWeight.w600, color: color)),
          ],
        ),
      );
}
