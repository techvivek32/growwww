import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mnha_mobile/theme.dart';
import 'package:mnha_mobile/widgets/common.dart';

/// Unit coverage for the formatting and painting helpers.
///
/// These are deliberately the pieces under test: they are where a wrong
/// answer is both easy to introduce and hard to notice. A widget test of a
/// data screen would mostly assert that the network is mocked, which proves
/// very little.
void main() {
  group('money formatting', () {
    test('uses the en-IN lakh/crore grouping', () {
      // 1234567 groups as 12,34,567 in en-IN — not 1,234,567.
      expect(money(1234567), contains('12,34,567'));
    });

    test('null is an em dash, never zero', () {
      // The whole point: an unknown balance must not render as ₹0.00.
      expect(money(null), '—');
      expect(num_(null), '—');
      expect(pct(null), '—');
      expect(signed(null), '—');
    });

    test('compact form switches at lakh and crore', () {
      expect(moneyCompact(150000), '₹1.50L');
      expect(moneyCompact(25000000), '₹2.50Cr');
      expect(moneyCompact(-150000), '-₹1.50L');
    });

    test('percentages and amounts always carry an explicit sign', () {
      expect(pct(2.5), '+2.50%');
      expect(pct(-2.5), '-2.50%');
      expect(signed(100).startsWith('+'), isTrue);
    });
  });

  group('move colour', () {
    test('zero and null are neutral, not green', () {
      // A flat tape is not a gain.
      expect(T.move(0), T.ink3);
      expect(T.move(null), T.ink3);
    });

    test('green up, vermilion down', () {
      expect(T.move(1), T.up);
      expect(T.move(-1), T.down);
    });
  });

  testWidgets('Spark survives flat and single-point series', (tester) async {
    // A flat series has zero range; the painter must centre it rather than
    // divide by zero.
    for (final series in [<double>[], [1.0], [5.0, 5.0, 5.0]]) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: Spark(series, color: T.mark)),
        ),
      );
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('Empty renders its title and detail', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Empty(
            icon: Icons.inbox_outlined,
            title: 'No holdings',
            detail: 'Nothing to show.',
          ),
        ),
      ),
    );
    expect(find.text('No holdings'), findsOneWidget);
    expect(find.text('Nothing to show.'), findsOneWidget);
  });
}
