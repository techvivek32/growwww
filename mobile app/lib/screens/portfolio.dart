import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// Holdings and open positions.
///
/// The screen draws a hard line between "no broker connected" and "connected,
/// nothing held". Both arrive here as an empty list, and showing the same
/// empty state for each would quietly tell someone their account is empty
/// when the truth is that nothing is attached to read.
class PortfolioScreen extends StatelessWidget {
  /// Opens the shell's navigation drawer. Null when this screen is pushed
  /// rather than shown as a bottom-bar destination.
  final VoidCallback? onMenu;
  const PortfolioScreen({super.key, this.onMenu});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Portfolio'),
        leading: onMenu == null
            ? null
            : IconButton(icon: const Icon(Icons.menu), onPressed: onMenu),
          bottom: const TabBar(
            indicatorColor: T.mark,
            indicatorWeight: 2,
            labelStyle: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            tabs: [Tab(text: 'Holdings'), Tab(text: 'Positions')],
          ),
        ),
        body: Load<({bool connected, List<Holding> holdings, List<Position> positions})>(
          load: api.portfolio,
          builder: (d) {
            if (!d.connected) return const _NotConnected();
            return TabBarView(
              children: [
                _Holdings(d.holdings),
                _Positions(d.positions),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _NotConnected extends StatelessWidget {
  const _NotConnected();

  @override
  Widget build(BuildContext context) => ListView(
        children: const [
          SizedBox(
            height: 420,
            child: Empty(
              icon: Icons.link_off,
              title: 'No broker connected',
              detail:
                  'Holdings, positions and orders come from your Groww account. '
                  'Until one is connected there is nothing to read — and an '
                  'empty account and an absent account are different facts, so '
                  'this screen will not show you a zero that is not true.\n\n'
                  'Connect a broker on the website to see them here.',
            ),
          ),
        ],
      );
}

class _Holdings extends StatelessWidget {
  final List<Holding> items;
  const _Holdings(this.items);

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return ListView(
        children: const [
          SizedBox(
            height: 380,
            child: Empty(
              icon: Icons.inbox_outlined,
              title: 'No holdings',
              detail: 'Your Groww account is connected and holds no delivery positions.',
            ),
          ),
        ],
      );
    }

    // Summed only over rows that actually have a live price, so a missing
    // quote does not silently drag the total down.
    final priced = items.where((h) => h.ltp != null);
    final value = priced.fold<double>(0, (a, h) => a + h.value!);
    final pnl = priced.fold<double>(0, (a, h) => a + h.pnl!);
    final missing = items.length - priced.length;

    return ListView(
      padding: const EdgeInsets.only(bottom: 28),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
          child: Panel(
            child: Row(
              children: [
                _stat(context, 'Current value', moneyCompact(value)),
                Container(width: 1, height: 36, color: Theme.of(context).dividerColor),
                _stat(
                  context,
                  'Total P&L',
                  signed(pnl),
                  color: T.move(pnl, dark: Theme.of(context).brightness == Brightness.dark),
                ),
              ],
            ),
          ),
        ),
        if (missing > 0)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
            child: Text(
              '$missing holding${missing == 1 ? '' : 's'} had no live price and '
              '${missing == 1 ? 'is' : 'are'} excluded from these totals.',
              style: const TextStyle(fontSize: 11.5, color: T.warn, height: 1.4),
            ),
          ),
        const SectionTitle('Holdings'),
        for (final h in items)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: _HoldingRow(h),
          ),
      ],
    );
  }

  Widget _stat(BuildContext context, String label, String value, {Color? color}) => Expanded(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
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
              Text(
                value,
                style: kNum.copyWith(fontSize: 17, fontWeight: FontWeight.w600, color: color),
              ),
            ],
          ),
        ),
      );
}

class _HoldingRow extends StatelessWidget {
  final Holding h;
  const _HoldingRow(this.h);

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final c = T.move(h.pnl, dark: dark);
    return Panel(
      padding: const EdgeInsets.all(13),
      child: Row(
        children: [
          Expanded(
            flex: 5,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(h.symbol,
                    style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700)),
                // The company name is in the payload and was being thrown
                // away. A ticker alone is not an answer to "what do I hold":
                // the web Stock column prints both.
                if (h.company.isNotEmpty && h.company != h.symbol) ...[
                  const SizedBox(height: 1),
                  Text(
                    h.company,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.5),
                    ),
                  ),
                ],
                const SizedBox(height: 3),
                Text(
                  '${h.qty} × ${num_(h.avg)}',
                  style: kNum.copyWith(
                    fontSize: 11.5,
                    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                  ),
                ),
                // Invested and, once a price is known, what it is worth now —
                // the web's Avg cost and Value columns.
                Text(
                  h.ltp == null
                      ? 'invested ${money2(h.qty * h.avg)}'
                      : 'invested ${money2(h.qty * h.avg)}  ·  now ${money2(h.qty * h.ltp!)}',
                  style: kNum.copyWith(
                    fontSize: 10.5,
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withValues(alpha: 0.45),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 4,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // "—" not "0.00" when there is no live price: the position is
                // real, the price is unknown, and those must look different.
                Text(
                  h.ltp == null ? '—' : num_(h.ltp),
                  style: kNum.copyWith(fontSize: 14.5, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 3),
                Text(
                  h.pnl == null ? 'no live price' : '${signed(h.pnl)}  ${pct(h.pnlPct)}',
                  style: kNum.copyWith(
                    fontSize: 11.5,
                    color: h.pnl == null ? T.warn : c,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                // The day's move on the stock itself — the web's Day column.
                // Distinct from the P&L above, which is against YOUR average
                // cost; a holding can be up on the day and still down overall.
                if (h.dayPct != null)
                  Text(
                    'day ${pct(h.dayPct)}',
                    style: kNum.copyWith(
                      fontSize: 10.5,
                      color: T.move(h.dayPct, dark: dark),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Positions extends StatelessWidget {
  final List<Position> items;
  const _Positions(this.items);

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return ListView(
        children: const [
          SizedBox(
            height: 380,
            child: Empty(
              icon: Icons.swap_horiz,
              title: 'No open positions',
              detail: 'Intraday and F&O positions appear here while they are open.',
            ),
          ),
        ],
      );
    }
    final dark = Theme.of(context).brightness == Brightness.dark;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        for (final p in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Panel(
              padding: const EdgeInsets.all(13),
              child: Row(
                children: [
                  Expanded(
                    flex: 5,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                p.symbol,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 14, fontWeight: FontWeight.w700),
                              ),
                            ),
                            const SizedBox(width: 6),
                            _chip(context, p.side),
                            const SizedBox(width: 4),
                            _chip(context, p.product),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${p.qty} × ${num_(p.avg)}',
                          style: kNum.copyWith(
                            fontSize: 11.5,
                            color:
                                Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    flex: 3,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          p.ltp == null ? '—' : num_(p.ltp),
                          style: kNum.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          p.unrealised == null ? 'no live price' : signed(p.unrealised),
                          style: kNum.copyWith(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w500,
                            color: p.unrealised == null
                                ? T.warn
                                : T.move(p.unrealised, dark: dark),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _chip(BuildContext context, String text) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        decoration: BoxDecoration(
          color: text == 'SELL'
              ? T.down.withValues(alpha: 0.14)
              : Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(2),
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.4,
            color: text == 'SELL'
                ? T.down
                : Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.7),
          ),
        ),
      );
}
