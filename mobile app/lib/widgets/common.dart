import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../env.dart';
import '../theme.dart';

/// en-IN money, with the lakh/crore grouping the web app uses. ₹12,34,567.
/// Not `NumberFormat.currency(locale: 'en_IN')` alone, because the compact
/// forms below have to agree with it and with `src/lib/format.ts`.
final _money = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);
final _moneyFlat = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _plain = NumberFormat.decimalPattern('en_IN');

String money(num? v, {bool decimals = true}) {
  if (v == null) return '—';
  return decimals ? _money.format(v) : _moneyFlat.format(v);
}

/// Lakh/crore for large figures — ₹1.2Cr reads faster than ₹1,20,00,000 on a
/// phone, and that is what the web does too.
String moneyCompact(num? v) {
  if (v == null) return '—';
  final a = v.abs();
  final sign = v < 0 ? '-' : '';
  if (a >= 10000000) return '$sign₹${(a / 10000000).toStringAsFixed(2)}Cr';
  if (a >= 100000) return '$sign₹${(a / 100000).toStringAsFixed(2)}L';
  return _moneyFlat.format(v);
}

/// Money with two decimals, accepting the loosely-typed values that come back
/// from the admin endpoints. Null is an em dash, never ₹0 — the whole app
/// keeps "unknown" and "zero" apart, and a fee ledger is the last place to
/// start confusing them.
String money2(dynamic v) => v == null ? '—' : _money.format((v as num).toDouble());

String num_(num? v, {int dp = 2}) => v == null ? '—' : v.toDouble().toStringAsFixed(dp);
String count(num? v) => v == null ? '—' : _plain.format(v);

/// Always signed, so a positive move is unmistakably positive at a glance.
String pct(num? v) => v == null ? '—' : '${v >= 0 ? '+' : ''}${v.toStringAsFixed(2)}%';
String signed(num? v) => v == null ? '—' : '${v >= 0 ? '+' : ''}${money(v)}';

/// The section heading used across the app: small, uppercase, letter-spaced,
/// with a rule under it. Matches the web's editorial headings.
class SectionTitle extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const SectionTitle(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 22, 16, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: TextStyle(
                fontSize: 10.5,
                letterSpacing: 1.0,
                fontWeight: FontWeight.w600,
                color: c.onSurface.withValues(alpha: 0.55),
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// A bordered panel. The web uses hairline rules and almost no radius, so
/// this deliberately avoids Material's rounded, shadowed card.
class Panel extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  const Panel({super.key, required this.child, this.padding = const EdgeInsets.all(14)});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: t.colorScheme.surface,
        border: Border.all(color: t.dividerColor),
        borderRadius: BorderRadius.circular(3),
      ),
      padding: padding,
      child: child,
    );
  }
}

/// An honest empty state. [detail] is what separates "nothing here" from
/// "we could not find out" — the web app is careful about that distinction
/// and so is this.
class Empty extends StatelessWidget {
  final IconData icon;
  final String title;
  final String detail;
  final Widget? action;
  const Empty({
    super.key,
    required this.icon,
    required this.title,
    required this.detail,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 34, color: c.onSurface.withValues(alpha: 0.3)),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13.5,
                height: 1.55,
                color: c.onSurface.withValues(alpha: 0.6),
              ),
            ),
            if (action != null) ...[const SizedBox(height: 20), action!],
          ],
        ),
      ),
    );
  }
}

/// The marker for a price that came from the committed snapshot rather than a
/// live fetch. Never silently omitted — a stale price presented as live is
/// precisely the failure this exists to prevent.
class StaleTag extends StatelessWidget {
  final String? asOf;
  const StaleTag({super.key, this.asOf});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: T.warn.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Text(
        asOf == null ? 'SNAPSHOT' : 'AS OF $asOf',
        style: const TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: T.warn,
        ),
      ),
    );
  }
}

/// A compact sparkline. Flat or single-point series render as a flat rule
/// rather than throwing or drawing nothing.
class Spark extends StatelessWidget {
  final List<double> data;
  final Color color;
  final Size size;
  const Spark(this.data, {super.key, required this.color, this.size = const Size(60, 22)});

  @override
  Widget build(BuildContext context) =>
      CustomPaint(size: size, painter: _SparkPainter(data, color));
}

class _SparkPainter extends CustomPainter {
  final List<double> d;
  final Color color;
  _SparkPainter(this.d, this.color);

  @override
  void paint(Canvas canvas, Size size) {
    if (d.length < 2) return;
    final lo = d.reduce((a, b) => a < b ? a : b);
    final hi = d.reduce((a, b) => a > b ? a : b);
    final span = hi - lo;
    final path = Path();
    for (var i = 0; i < d.length; i++) {
      final x = size.width * (i / (d.length - 1));
      // A flat series has no range to scale into; centre it instead of
      // dividing by zero.
      final y = span == 0 ? size.height / 2 : size.height * (1 - (d[i] - lo) / span);
      i == 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = 1.4
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_SparkPainter old) => !identical(old.d, d) || old.color != color;
}

/// A loud badge on any build that is not production.
///
/// Worth the screen space: local and live render identically, and a
/// screenshot of test data read as the real account is a genuinely expensive
/// confusion in a trading app. Renders nothing in a live build.
class EnvBadge extends StatelessWidget {
  const EnvBadge({super.key});

  @override
  Widget build(BuildContext context) {
    if (Env.isLive) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: T.warn,
        borderRadius: BorderRadius.circular(2),
      ),
      child: Text(
        Env.label,
        style: const TextStyle(
          fontSize: 9.5,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.7,
          color: Colors.white,
        ),
      ),
    );
  }
}

/// A full-width strip naming the server a non-production build talks to.
/// Shown on sign-in, where it matters most — that is the screen a password
/// is typed into, so which host receives it should be unambiguous.
class EnvBanner extends StatelessWidget {
  const EnvBanner({super.key});

  @override
  Widget build(BuildContext context) {
    if (Env.isLive) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: T.warn.withValues(alpha: 0.18),
        border: Border.all(color: T.warn),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Row(
        children: [
          const Icon(Icons.science_outlined, size: 16, color: T.warn),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              '${Env.label} build · ${Env.apiBase}',
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.4,
                fontWeight: FontWeight.w600,
                color: T.warn,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Error state with a retry. Shown instead of an empty list when a read
/// fails, because on a phone an empty account and a failed request look
/// identical and only one of them is safe to believe.
class ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const ErrorState({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) => Empty(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load',
        detail: message,
        action: OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
      );
}

/// "4m ago" for an epoch-ms stamp. Null or zero reads as "never", which is a
/// different statement from "a long time ago" — an engine that has never run
/// and one that ran last week should not look the same.
/// An absolute timestamp in IST, matching the admin console's `fmtDate`
/// ("19 Nov 26, 04:58 pm").
///
/// Pinned to IST rather than the phone's own zone deliberately. The console is
/// the record of an Indian market business, and a signature must not appear to
/// have happened at a different hour because the admin opened the app from
/// another country. `ago()` answers "how long since"; this answers "when",
/// and an audit row needs both.
String fmtStamp(int? ms) {
  if (ms == null || ms == 0) return 'unknown';
  final t = DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true)
      .add(const Duration(hours: 5, minutes: 30));
  const mon = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  final ampm = t.hour < 12 ? 'am' : 'pm';
  return '${t.day} ${mon[t.month - 1]} ${t.year % 100}, '
      '${h.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')} $ampm';
}

String ago(int? at) {
  if (at == null || at == 0) return 'never';
  final ms = DateTime.now().millisecondsSinceEpoch - at;
  // Not every timestamp is in the past. A member's period END, a scheduled
  // verification call and a settlement date are all ahead of now, and the
  // subtraction simply went negative for them: an active member's card read
  // "period ends -2591817s ago", which is not even wrong in a useful way.
  final ahead = ms < 0;
  final secs = ms.abs() ~/ 1000;
  final span = secs < 60
      ? '${secs}s'
      : secs < 3600
          ? '${secs ~/ 60}m'
          : secs < 86400
              ? '${secs ~/ 3600}h'
              : '${secs ~/ 86400}d';
  return ahead ? 'in $span' : '$span ago';
}
