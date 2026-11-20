import 'package:flutter/material.dart';

/// The design tokens from `src/app/globals.css`, transcribed.
///
/// The web app is light-first on purpose — Groww is a light product, and the
/// terminal follows it — so the light scheme here is the primary one and dark
/// is the variant, not the other way round.
///
/// These are deliberately plain constants rather than a generated palette:
/// the web side owns the design language, and a value that drifts should be
/// obvious in a diff rather than buried in a shade calculation.
class T {
  // ---- light (the primary theme) -----------------------------------------
  static const bg = Color(0xFFF3EFE6); // --c-bg: warm paper
  static const surface = Color(0xFFFBF9F4); // --c-surface
  static const surface2 = Color(0xFFEEE9DD); // --c-surface-2
  static const border = Color(0xFFE0D9CA); // --c-border
  static const borderStrong = Color(0xFFC9C0AE); // --c-border-strong

  static const ink = Color(0xFF15140F); // --c-text
  static const ink2 = Color(0xFF4A463D); // --c-text-2
  static const ink3 = Color(0xFF6E695E); // --c-text-3

  static const mark = Color(0xFFD9471F); // --c-mark: the vermilion accent
  static const up = Color(0xFF2C6A47); // --c-up
  static const upSoft = Color(0xFFE2ECE4);
  static const down = Color(0xFFB23A1C); // --c-down
  static const downSoft = Color(0xFFF5E2DA);
  static const warn = Color(0xFF8F570C); // --c-warn

  // ---- dark ---------------------------------------------------------------
  // Taken from the admin sidebar's ink panel, which is the app's dark surface
  // in both themes, so the two agree instead of inventing a second dark.
  static const dBg = Color(0xFF15140F); // --c-side-bg-2
  static const dSurface = Color(0xFF1D1B16); // --c-side-bg
  static const dSurface2 = Color(0xFF28251E); // --c-side-hover
  static const dBorder = Color(0xFF33302A); // --c-side-line
  static const dInk = Color(0xFFEEE9DD); // --c-side-text
  static const dInk2 = Color(0xFFA9A396);
  static const dInk3 = Color(0xFF8F8A7C); // --c-side-muted

  /// Green for a rise, vermilion for a fall — the Indian market convention
  /// the web app already uses. Zero is deliberately neutral rather than
  /// green: a flat tape is not a gain.
  static Color move(num? v, {bool dark = false}) {
    if (v == null || v == 0) return dark ? dInk3 : ink3;
    return v > 0 ? (dark ? const Color(0xFF4E9E71) : up) : (dark ? const Color(0xFFE2693F) : down);
  }

  static ThemeData light() => _build(
        brightness: Brightness.light,
        bg: bg,
        surface: surface,
        border: border,
        text: ink,
        text2: ink2,
        text3: ink3,
      );

  static ThemeData dark() => _build(
        brightness: Brightness.dark,
        bg: dBg,
        surface: dSurface,
        border: dBorder,
        text: dInk,
        text2: dInk2,
        text3: dInk3,
      );

  static ThemeData _build({
    required Brightness brightness,
    required Color bg,
    required Color surface,
    required Color border,
    required Color text,
    required Color text2,
    required Color text3,
  }) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: text,
      onPrimary: surface,
      secondary: mark,
      onSecondary: Colors.white,
      error: down,
      onError: Colors.white,
      surface: surface,
      onSurface: text,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      dividerColor: border,
      dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: text,
          fontSize: 17,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
        // A hairline rule under the bar, like the web header.
        shape: Border(bottom: BorderSide(color: border, width: 1)),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        // Thin borders and square-ish corners — the web uses hairline rules
        // and 2px radii, not the rounded cards Material defaults to.
        shape: RoundedRectangleBorder(
          side: BorderSide(color: border),
          borderRadius: BorderRadius.circular(3),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
        border: OutlineInputBorder(
          borderSide: BorderSide(color: border),
          borderRadius: BorderRadius.circular(3),
        ),
        enabledBorder: OutlineInputBorder(
          borderSide: BorderSide(color: border),
          borderRadius: BorderRadius.circular(3),
        ),
        focusedBorder: OutlineInputBorder(
          borderSide: const BorderSide(color: mark, width: 1.5),
          borderRadius: BorderRadius.circular(3),
        ),
        labelStyle: TextStyle(color: text3),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: text,
          foregroundColor: surface,
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: mark.withValues(alpha: 0.12),
        elevation: 0,
        height: 64,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 11, color: text2, fontWeight: FontWeight.w500),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: text,
        contentTextStyle: TextStyle(color: surface),
        behavior: SnackBarBehavior.floating,
      ),
      textTheme: Typography.material2021(platform: TargetPlatform.android)
          .black
          .apply(bodyColor: text, displayColor: text),
    );
  }
}

/// Tabular figures, so a column of prices lines up digit for digit instead of
/// shuffling as values change. Worth stating explicitly: proportional digits
/// in a live price column are genuinely hard to read.
const kNum = TextStyle(fontFeatures: [FontFeature.tabularFigures()]);
