import 'package:flutter/material.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// One instrument — the web's `/stock/[symbol]`. Price, chart, day range, and
/// this account's holding in it if there is one.
class StockScreen extends StatefulWidget {
  final String symbol;
  const StockScreen({super.key, required this.symbol});

  @override
  State<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends State<StockScreen> {
  String _range = '3M';
  late Future<StockDetail> _f;

  @override
  void initState() {
    super.initState();
    _f = api.stock(widget.symbol, range: _range);
  }

  void _setRange(String r) {
    setState(() {
      _range = r;
      _f = api.stock(widget.symbol, range: r);
    });
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      appBar: AppBar(title: Text(widget.symbol)),
      body: FutureBuilder<StockDetail>(
        future: _f,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return ErrorState(
              message: snap.error is ApiError
                  ? (snap.error as ApiError).message
                  : 'Could not load ${widget.symbol}.',
              onRetry: () => _setRange(_range),
            );
          }
          final d = snap.data!;
          final q = d.quote;
          final c = T.move(q.changePct, dark: dark);

          return ListView(
            padding: const EdgeInsets.only(bottom: 28),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            q.name,
                            style: TextStyle(
                              fontSize: 13,
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurface
                                  .withValues(alpha: 0.6),
                            ),
                          ),
                        ),
                        if (q.stale) StaleTag(asOf: q.asOf),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(num_(q.last),
                        style: kNum.copyWith(fontSize: 30, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text(
                      '${q.change >= 0 ? '+' : ''}${num_(q.change)}   ${pct(q.changePct)}',
                      style: kNum.copyWith(
                          fontSize: 14, color: c, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),

              // Chart. A single-point or empty series draws nothing rather
              // than throwing — see Spark.
              if (d.series != null && d.series!.points.length > 1)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
                  child: Panel(
                    padding: const EdgeInsets.fromLTRB(8, 14, 8, 8),
                    child: Spark(
                      d.series!.points,
                      color: c,
                      size: Size(MediaQuery.of(context).size.width - 50, 150),
                    ),
                  ),
                ),

              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Wrap(
                  spacing: 7,
                  children: [
                    for (final r in d.ranges)
                      GestureDetector(
                        onTap: () => _setRange(r),
                        child: Container(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
                          decoration: BoxDecoration(
                            color: r == _range
                                ? T.mark.withValues(alpha: 0.14)
                                : Colors.transparent,
                            border: Border.all(
                              color: r == _range ? T.mark : Theme.of(context).dividerColor,
                            ),
                            borderRadius: BorderRadius.circular(2),
                          ),
                          child: Text(
                            r,
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: r == _range
                                  ? T.mark
                                  : Theme.of(context)
                                      .colorScheme
                                      .onSurface
                                      .withValues(alpha: 0.65),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),

              const SectionTitle('Day'),
              _row(context, 'High', num_(q.dayHigh)),
              _row(context, 'Low', num_(q.dayLow)),
              _row(context, 'Previous close', num_(q.last - q.change)),
              _row(context, 'Volume', count(q.volume)),

              if (d.holding != null) ...[
                const SectionTitle('Your holding'),
                _row(context, 'Quantity', '${d.holding!.qty}'),
                _row(context, 'Average cost', num_(d.holding!.avg)),
                _row(context, 'Current value', money(d.holding!.value)),
                _row(
                  context,
                  'P&L',
                  d.holding!.pnl == null
                      ? 'no live price'
                      : '${signed(d.holding!.pnl)}  ${pct(d.holding!.pnlPct)}',
                  color: d.holding!.pnl == null
                      ? T.warn
                      : T.move(d.holding!.pnl, dark: dark),
                ),
              ],

              if (d.position != null) ...[
                const SectionTitle('Open position'),
                _row(context, 'Side', d.position!.side),
                _row(context, 'Product', d.position!.product),
                _row(context, 'Quantity', '${d.position!.qty}'),
                _row(context, 'Average', num_(d.position!.avg)),
                _row(
                  context,
                  'Unrealised',
                  d.position!.unrealised == null
                      ? 'no live price'
                      : signed(d.position!.unrealised),
                  color: d.position!.unrealised == null
                      ? T.warn
                      : T.move(d.position!.unrealised, dark: dark),
                ),
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _row(BuildContext context, String label, String value, {Color? color}) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 1),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
          color: Theme.of(context).colorScheme.surface,
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65),
                  ),
                ),
              ),
              Text(value,
                  style: kNum.copyWith(
                      fontSize: 13, fontWeight: FontWeight.w600, color: color)),
            ],
          ),
        ),
      );
}
