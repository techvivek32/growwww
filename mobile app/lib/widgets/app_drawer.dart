import 'package:flutter/material.dart';
import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

/// Destinations the drawer pushes rather than switches to.
enum DrawerDest { analysis, research, notifications, account, legal }

/// The member/owner navigation drawer — the web's top rail, re-cut for a thumb.
///
/// The web carries sixteen sections in one scrolling rail. Five of those are
/// bottom-bar destinations here because they are visited constantly; the rest
/// live in this drawer, grouped the way `lib/nav.ts` groups them, so nothing
/// is more than two taps away from anywhere.
///
/// Owner-only sections are hidden for a member rather than shown-and-refused.
/// The server enforces the boundary either way (403 / 307); this just avoids
/// offering a door that will not open.
class AppDrawer extends StatelessWidget {
  final Me me;

  /// Index of the current bottom-bar destination, so the drawer can mark it.
  final int currentTab;

  /// Switches the bottom-bar destination (0-4) and closes the drawer.
  final ValueChanged<int> onTab;

  /// Pushes a screen that is not a bottom-bar destination.
  final ValueChanged<DrawerDest> onPush;

  const AppDrawer({
    super.key,
    required this.me,
    required this.currentTab,
    required this.onTab,
    required this.onPush,
  });

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: T.dSurface,
      child: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 14),
              child: Row(
                children: [
                  // The house mark, as on the sign-in screen.
                  for (final h in const [9.0, 15.0, 20.0, 27.0])
                    Container(
                      width: 7,
                      height: h,
                      margin: const EdgeInsets.only(right: 3),
                      color: h == 27.0 ? T.mark : T.dInk,
                    ),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          me.account.name.isEmpty ? 'MNHA' : me.account.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w700, color: T.dInk),
                        ),
                        Text(
                          me.role.toUpperCase(),
                          style: const TextStyle(
                              fontSize: 9,
                              letterSpacing: 1,
                              fontWeight: FontWeight.w700,
                              color: T.dInk3),
                        ),
                      ],
                    ),
                  ),
                  const EnvBadge(),
                ],
              ),
            ),
            const Divider(color: T.dBorder, height: 1),

            _head('TRADING'),
            _tab(context, 0, 'Home', Icons.home_outlined),
            _tab(context, 1, 'Markets',
                Icons.show_chart_outlined),
            _tab(context, 2, 'Watchlist', Icons.bookmark_outline),
            _tab(context, 3, 'Portfolio', Icons.pie_chart_outline),
            _tab(context, 4, 'Orders & history', Icons.receipt_long_outlined),
            _push(context, DrawerDest.analysis, 'Analysis', Icons.insights_outlined),

            _head('RESEARCH'),
            _push(
              context,
              DrawerDest.research,
              // A member gets the option chain only; the owner gets the
              // scanner, the strategy board and linked accounts too.
              me.isOwner ? 'Scanner, strategies, chain' : 'Option chain',
              Icons.science_outlined,
            ),

            _head('ACCOUNT'),
            _push(context, DrawerDest.notifications, 'Notifications', Icons.notifications_none),
            _push(context, DrawerDest.account, 'Settings, broker, membership',
                Icons.person_outline),
            _push(context, DrawerDest.legal, 'Legal', Icons.gavel_outlined),

            const SizedBox(height: 18),
            const Divider(color: T.dBorder, height: 1),
            const Padding(
              padding: EdgeInsets.fromLTRB(18, 14, 18, 20),
              child: Text(
                'Decision support, not advice. Orders are placed from the desk, '
                'never from this app.',
                style: TextStyle(fontSize: 10.5, height: 1.5, color: T.dInk3),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _head(String s) => Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 6),
        child: Text(s,
            style: const TextStyle(
                fontSize: 9.5,
                letterSpacing: 1.1,
                fontWeight: FontWeight.w700,
                color: T.dInk3)),
      );

  Widget _tab(BuildContext context, int i, String label, IconData icon) => _Row(
        label: label,
        icon: icon,
        active: currentTab == i,
        onTap: () {
          Navigator.of(context).pop();
          onTab(i);
        },
      );

  Widget _push(BuildContext context, DrawerDest d, String label, IconData icon) => _Row(
        label: label,
        icon: icon,
        active: false,
        onTap: () {
          Navigator.of(context).pop();
          onPush(d);
        },
      );
}


class _Row extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;
  const _Row({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: active ? T.dSurface2 : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Row(
          children: [
            // Accent bar on the current section, matching the admin console.
            Container(width: 3, height: 44, color: active ? T.mark : Colors.transparent),
            const SizedBox(width: 13),
            Icon(icon, size: 18, color: active ? T.mark : T.dInk3),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                  color: active ? T.dInk : T.dInk2,
                ),
              ),
            ),
            const SizedBox(width: 12),
          ],
        ),
      ),
    );
  }
}
