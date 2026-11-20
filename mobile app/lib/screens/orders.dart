import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';

/// Today's order book, and the closed-trade archive.
///
/// Read-only by design. The web app places orders through a server action
/// that reaches a gateway on an IP registered with the broker; SEBI's static
/// IP rule means a phone can never be that origin. Showing a Buy button here
/// would promise something the architecture cannot deliver.
class OrdersScreen extends StatelessWidget {
  /// Opens the shell's navigation drawer. Null when this screen is pushed
  /// rather than shown as a bottom-bar destination.
  final VoidCallback? onMenu;
  const OrdersScreen({super.key, this.onMenu});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Orders'),
        leading: onMenu == null
            ? null
            : IconButton(icon: const Icon(Icons.menu), onPressed: onMenu),
          bottom: const TabBar(
            indicatorColor: T.mark,
            indicatorWeight: 2,
            labelStyle: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            tabs: [Tab(text: 'Order book'), Tab(text: 'History')],
          ),
        ),
        body: Load<({bool connected, List<Order> orders, List<Trade> trades})>(
          load: () => api.orders(history: true),
          builder: (d) {
            if (!d.connected) {
              return ListView(
                children: const [
                  SizedBox(
                    height: 420,
                    child: Empty(
                      icon: Icons.link_off,
                      title: 'No broker connected',
                      detail:
                          'Your order book and trade history come from your Groww '
                          'account. Connect a broker on the website to see them here.',
                    ),
                  ),
                ],
              );
            }
            return TabBarView(children: [OrdersList(d.orders), HistoryList(d.trades)]);
          },
        ),
      ),
    );
  }
}

Color _statusColor(String s) => switch (s) {
      'COMPLETE' => T.up,
      'REJECTED' => T.down,
      'CANCELLED' => T.ink3,
      'OPEN' || 'TRIGGER PENDING' => T.warn,
      _ => T.ink3,
    };

class OrdersList extends StatelessWidget {
  final List<Order> items;
  const OrdersList(this.items, {super.key});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return ListView(
        children: const [
          SizedBox(
            height: 380,
            child: Empty(
              icon: Icons.receipt_long_outlined,
              title: 'No orders today',
              detail: 'Orders placed in this session appear here.',
            ),
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        for (final o in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Panel(
              padding: const EdgeInsets.all(13),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                        decoration: BoxDecoration(
                          color: (o.side == 'SELL' ? T.down : T.up).withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(2),
                        ),
                        child: Text(
                          o.side,
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            color: o.side == 'SELL' ? T.down : T.up,
                          ),
                        ),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          o.symbol,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                        ),
                      ),
                      Text(
                        o.status,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.3,
                          color: _statusColor(o.status),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 9),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          // filled/qty, because a partially filled order is a
                          // different situation from an unfilled one.
                          '${o.filled}/${o.qty}  ·  ${o.type}  ·  ${o.product}',
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
                        o.avg != null
                            ? num_(o.avg)
                            : o.price != null
                                ? num_(o.price)
                                : '—',
                        style: kNum.copyWith(fontSize: 13, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  if (o.time.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Text(
                      o.time,
                      style: TextStyle(
                        fontSize: 10.5,
                        color:
                            Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.45),
                      ),
                    ),
                  ],
                  if (o.note != null && o.note!.isNotEmpty) ...[
                    const SizedBox(height: 7),
                    Text(
                      o.note!,
                      style: const TextStyle(fontSize: 11.5, color: T.warn, height: 1.4),
                    ),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class HistoryList extends StatelessWidget {
  final List<Trade> items;
  const HistoryList(this.items, {super.key});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return ListView(
        children: const [
          SizedBox(
            height: 380,
            child: Empty(
              icon: Icons.history,
              title: 'No closed trades',
              detail: 'Round trips appear here once a position is fully closed.',
            ),
          ),
        ],
      );
    }
    final dark = Theme.of(context).brightness == Brightness.dark;
    final net = items.fold<double>(0, (a, t) => a + t.pnl);
    final wins = items.where((t) => t.pnl > 0).length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        Panel(
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('NET P&L',
                        style: TextStyle(
                            fontSize: 9.5,
                            letterSpacing: 0.7,
                            fontWeight: FontWeight.w600,
                            color: T.ink3)),
                    const SizedBox(height: 5),
                    Text(signed(net),
                        style: kNum.copyWith(
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                            color: T.move(net, dark: dark))),
                  ],
                ),
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('WIN RATE',
                        style: TextStyle(
                            fontSize: 9.5,
                            letterSpacing: 0.7,
                            fontWeight: FontWeight.w600,
                            color: T.ink3)),
                    const SizedBox(height: 5),
                    Text('${((wins / items.length) * 100).toStringAsFixed(0)}%  ·  $wins/${items.length}',
                        style: kNum.copyWith(fontSize: 17, fontWeight: FontWeight.w600)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        // Charges are null from Groww's payload, so P&L here is gross. Saying
        // so is better than quietly presenting gross as net.
        Text(
          'P&L is gross — Groww\'s order payload carries no per-trade charges.',
          style: TextStyle(
            fontSize: 11,
            height: 1.4,
            color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5),
          ),
        ),
        const SectionTitle('Closed trades'),
        for (final t in items)
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
                        Text(t.symbol,
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 3),
                        Text(
                          '${t.side}  ·  ${t.qty} × ${num_(t.entry)} → ${num_(t.exit)}',
                          style: kNum.copyWith(
                            fontSize: 11.5,
                            color: Theme.of(context)
                                .colorScheme
                                .onSurface
                                .withValues(alpha: 0.55),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(signed(t.pnl),
                          style: kNum.copyWith(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: T.move(t.pnl, dark: dark))),
                      const SizedBox(height: 3),
                      Text(t.date,
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
          ),
      ],
    );
  }
}
