import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'shell.dart';
import 'stock.dart';

/// Watchlists, with a live quote per symbol and add/remove.
///
/// This is the one screen that writes. The lists live server-side (the web
/// app keeps them in `data/watchlists.json`), so a symbol added on the phone
/// is on the list in the browser too — rather than two devices quietly
/// keeping different lists.
class WatchlistScreen extends StatefulWidget {
  /// Opens the shell's navigation drawer. Null when this screen is pushed
  /// rather than shown as a bottom-bar destination.
  final VoidCallback? onMenu;
  const WatchlistScreen({super.key, this.onMenu});
  @override
  State<WatchlistScreen> createState() => _WatchlistScreenState();
}

class _WatchlistScreenState extends State<WatchlistScreen> {
  // Bumped to force the Load below to re-run after a write, so the list the
  // server now holds is what gets rendered — not a locally patched guess.
  int _rev = 0;

  Future<void> _add(String listId) async {
    final symbol = await showDialog<String>(
      context: context,
      builder: (_) => const _AddDialog(),
    );
    if (symbol == null || symbol.isEmpty) return;
    await _write(listId, symbol, 'add');
  }

  Future<void> _write(String listId, String symbol, String action) async {
    try {
      await api.editWatchlist(listId, symbol, action);
      if (mounted) setState(() => _rev++);
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Watchlist'),
        leading: widget.onMenu == null
            ? null
            : IconButton(icon: const Icon(Icons.menu), onPressed: widget.onMenu),
      ),
      body: Load<List<Watchlist>>(
        key: ValueKey(_rev),
        load: api.watchlists,
        builder: (lists) {
          if (lists.isEmpty) {
            return ListView(
              children: const [
                SizedBox(
                  height: 400,
                  child: Empty(
                    icon: Icons.bookmark_outline,
                    title: 'No lists',
                    detail: 'Create a watchlist on the website and it appears here.',
                  ),
                ),
              ],
            );
          }
          return ListView(
            padding: const EdgeInsets.only(bottom: 28),
            children: [
              for (final l in lists) ...[
                SectionTitle(
                  l.name,
                  trailing: IconButton(
                    icon: const Icon(Icons.add, size: 20),
                    visualDensity: VisualDensity.compact,
                    onPressed: () => _add(l.id),
                    tooltip: 'Add symbol',
                  ),
                ),
                if (l.symbols.isEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Panel(
                      child: Text(
                        'Nothing on this list yet.',
                        style: TextStyle(
                          fontSize: 13,
                          color:
                              Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
                        ),
                      ),
                    ),
                  )
                else
                  for (var i = 0; i < l.symbols.length; i++)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: Dismissible(
                        key: ValueKey('${l.id}:${l.symbols[i]}'),
                        direction: DismissDirection.endToStart,
                        background: Container(
                          alignment: Alignment.centerRight,
                          padding: const EdgeInsets.only(right: 16),
                          decoration: BoxDecoration(
                            color: T.down.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: const Icon(Icons.delete_outline, color: T.down),
                        ),
                        onDismissed: (_) => _write(l.id, l.symbols[i], 'remove'),
                        child: GestureDetector(
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => StockScreen(symbol: l.symbols[i]),
                            ),
                          ),
                          child: _Row(
                              symbol: l.symbols[i],
                              quote: l.quotes.elementAtOrNull(i)),
                        ),
                      ),
                    ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String symbol;
  final Quote? quote;
  const _Row({required this.symbol, this.quote});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final q = quote;
    final c = T.move(q?.changePct, dark: dark);
    return Panel(
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
                        symbol,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
                      ),
                    ),
                    if (q?.stale == true) ...[
                      const SizedBox(width: 6),
                      StaleTag(asOf: q!.asOf),
                    ],
                  ],
                ),
                if (q != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    q.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (q != null && q.spark.length > 1) ...[
            Spark(q.spark, color: c, size: const Size(46, 20)),
            const SizedBox(width: 12),
          ],
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              // A symbol with no quote still shows — it is on the list, and
              // dropping the row would hide something the user put there.
              Text(
                q == null ? '—' : num_(q.last),
                style: kNum.copyWith(fontSize: 14.5, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 3),
              Text(
                q == null ? 'no quote' : pct(q.changePct),
                style: kNum.copyWith(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w500,
                  color: q == null ? T.warn : c,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AddDialog extends StatefulWidget {
  const _AddDialog();
  @override
  State<_AddDialog> createState() => _AddDialogState();
}

class _AddDialogState extends State<_AddDialog> {
  final _c = TextEditingController();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _submit() => Navigator.pop(context, _c.text.trim().toUpperCase());

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add symbol'),
      content: TextField(
        controller: _c,
        autofocus: true,
        textCapitalization: TextCapitalization.characters,
        autocorrect: false,
        decoration: const InputDecoration(
          hintText: 'RELIANCE',
          helperText: 'NSE trading symbol, without .NS',
        ),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _submit,
          style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
          child: const Text('Add'),
        ),
      ],
    );
  }
}
