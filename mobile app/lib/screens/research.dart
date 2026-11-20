import 'package:flutter/material.dart';
import '../api/client.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';
import 'stock.dart';

/// The owner's research sections — the web's /stocks/scanner,
/// /stocks/alerts/backtest, /fno/chain and /linked-accounts.
///
/// Four tabs rather than four destinations: they are all reference tables,
/// consulted occasionally, and none of them earns a slot in a five-item rail.
class ResearchScreen extends StatelessWidget {
  final bool isOwner;
  const ResearchScreen({super.key, required this.isOwner});

  @override
  Widget build(BuildContext context) {
    // A member may open the option chain — it is market data, not an account
    // or a signal — but nothing else here. The server enforces this too.
    // 'Strategies' is gone: the signals engine it read was removed upstream,
    // so the tab would call an endpoint that no longer exists.
    final tabs = isOwner ? const ['Scanner', 'Chain', 'Linked'] : const ['Chain'];

    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Research'),
          bottom: TabBar(
            isScrollable: tabs.length > 3,
            tabAlignment: tabs.length > 3 ? TabAlignment.start : TabAlignment.fill,
            indicatorColor: T.mark,
            indicatorWeight: 2,
            labelStyle: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            tabs: [for (final t in tabs) Tab(text: t)],
          ),
        ),
        body: TabBarView(
          children: [
            if (isOwner) const _Scanner(),
            const _Chain(),
            if (isOwner) const _Linked(),
          ],
        ),
      ),
    );
  }
}

class _Scanner extends StatelessWidget {
  const _Scanner();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Load<Map<String, dynamic>>(
      load: () => api.research('scanner'),
      builder: (j) {
        final rows = (j['rows'] ?? []) as List;
        if (rows.isEmpty) {
          return ListView(
            children: const [
              SizedBox(
                height: 380,
                child: Empty(
                  icon: Icons.search_off,
                  title: 'Nothing scanned',
                  detail: 'The scan runs over the live NSE universe.',
                ),
              ),
            ],
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          itemCount: rows.length,
          itemBuilder: (context, i) {
            final r = rows[i] as Map<String, dynamic>;
            final pctV = (r['changePct'] as num?)?.toDouble();
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: GestureDetector(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => StockScreen(symbol: r['symbol'] as String),
                  ),
                ),
                child: Panel(
                  padding: const EdgeInsets.all(13),
                  child: Row(
                    children: [
                      Expanded(
                        flex: 5,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${r['symbol']}',
                                style: const TextStyle(
                                    fontSize: 14, fontWeight: FontWeight.w700)),
                            const SizedBox(height: 3),
                            Text(
                              '${r['company'] ?? ''}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
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
                          Text(num_((r['last'] as num?)?.toDouble()),
                              style: kNum.copyWith(
                                  fontSize: 14, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 3),
                          Text(pct(pctV),
                              style: kNum.copyWith(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w500,
                                  color: T.move(pctV, dark: dark))),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _Chain extends StatelessWidget {
  const _Chain();

  @override
  Widget build(BuildContext context) {
    return Load<Map<String, dynamic>>(
      load: () => api.research('chain'),
      builder: (j) {
        final chain = j['chain'] as Map<String, dynamic>?;
        // Null is the honest answer, and the empty state says why rather than
        // rendering a blank table that looks broken.
        if (chain == null) {
          return ListView(
            children: const [
              SizedBox(
                height: 420,
                child: Empty(
                  icon: Icons.table_chart_outlined,
                  title: 'No option chain',
                  detail:
                      'Yahoo carries no Indian option chain, so the chain stays '
                      'empty until Groww provides one. Modelling strikes locally '
                      'would put numbers on screen that no exchange ever printed.',
                ),
              ),
            ],
          );
        }
        final rows = (chain['rows'] ?? []) as List;
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          children: [
            Panel(
              child: Row(
                children: [
                  Expanded(
                      child: Text('${chain['underlying']}',
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w700))),
                  Text(num_((chain['spot'] as num?)?.toDouble()),
                      style:
                          kNum.copyWith(fontSize: 15, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            const SectionTitle('Strikes'),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Panel(
                  padding: const EdgeInsets.all(11),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          num_(((r as Map)['ce'] as Map?)?['ltp'] as num?),
                          style: kNum.copyWith(fontSize: 12.5, color: T.up),
                        ),
                      ),
                      Text('${r['strike']}',
                          style: kNum.copyWith(
                              fontSize: 13, fontWeight: FontWeight.w700)),
                      Expanded(
                        child: Text(
                          num_((r['pe'] as Map?)?['ltp'] as num?),
                          textAlign: TextAlign.right,
                          style: kNum.copyWith(fontSize: 12.5, color: T.down),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Linked extends StatelessWidget {
  const _Linked();

  @override
  Widget build(BuildContext context) {
    return Load<Map<String, dynamic>>(
      load: () => api.research('linked'),
      builder: (j) {
        final accounts = (j['accounts'] ?? []) as List;
        if (accounts.isEmpty) {
          return ListView(
            children: const [
              SizedBox(
                height: 380,
                child: Empty(
                  icon: Icons.account_tree_outlined,
                  title: 'No linked accounts',
                  detail: 'Accounts linked to this desk appear here.',
                ),
              ),
            ],
          );
        }
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          children: [
            for (final a in accounts)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Panel(
                  padding: const EdgeInsets.all(13),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${(a as Map)['name'] ?? a['id'] ?? 'Account'}',
                          style: const TextStyle(
                              fontSize: 14, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 4),
                      Text(
                        '${a['broker'] ?? ''}',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: Theme.of(context)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
