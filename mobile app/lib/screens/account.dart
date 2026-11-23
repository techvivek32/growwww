import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'admin.dart';
import 'analysis.dart';
import 'legal.dart';
import 'research.dart';
import 'shell.dart';

/// Account — what the web splits across /settings, /membership and /broker.
///
/// Loads `/api/mobile/account` rather than rendering from the shell's cached
/// `me`: membership, invoices, KYC state and the agreement version are not in
/// that payload, and a stale broker state on the one screen someone opens
/// *because* they suspect something is wrong is the worst place for it.
///
/// Also the honest home for everything the app does not do natively. Those
/// are named rather than hidden — a missing feature the user can find beats
/// one they discover at the moment they need it.
class AccountScreen extends StatelessWidget {
  final Me me;
  final VoidCallback onSignOut;
  final String landing;

  const AccountScreen({
    super.key,
    required this.me,
    required this.onSignOut,
    required this.landing,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Row(children: [Text('Account'), SizedBox(width: 8), EnvBadge()]),
      ),
      body: Load<AccountInfo>(load: api.account, builder: (a) => _body(context, a)),
    );
  }

  Widget _body(BuildContext context, AccountInfo a) {
    final m = a.membership;

    return ListView(
      padding: const EdgeInsets.only(bottom: 32),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(a.account.name.isEmpty ? 'Signed in' : a.account.name,
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                if (a.account.email.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(a.account.email,
                      style: TextStyle(
                        fontSize: 13,
                        color: Theme.of(context)
                            .colorScheme
                            .onSurface
                            .withValues(alpha: 0.6),
                      )),
                ],
                const SizedBox(height: 11),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _tag(context, a.role.toUpperCase()),
                    _tag(context, a.connected ? 'BROKER LIVE' : 'NO BROKER',
                        color: a.connected ? T.up : T.ink3),
                    if (a.connected && !a.canTrade)
                      _tag(context, 'READ-ONLY', color: T.warn),
                    if (a.unread > 0) _tag(context, '${a.unread} UNREAD', color: T.mark),
                  ],
                ),
              ],
            ),
          ),
        ),

        // An older-but-still-accepted signature is an invitation, not a gate:
        // the web does not block these members and neither does this.
        if (a.agreementUpdateOffered)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: Container(
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: T.warn.withValues(alpha: 0.10),
                border: Border.all(color: T.warn.withValues(alpha: 0.5)),
                borderRadius: BorderRadius.circular(3),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Agreement ${a.currentAgreement.split(' ').first} is available',
                      style: const TextStyle(
                          fontSize: 13.5, fontWeight: FontWeight.w600, color: T.warn)),
                  const SizedBox(height: 6),
                  Text(
                    'You signed ${a.signedAgreement?.split(' ').first ?? 'an earlier version'}. '
                    'The new one covers orders placed from MNHA, including orders '
                    'the admin places on your instruction. Nothing is blocked — '
                    'review and sign it on the website when you are ready.',
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.55,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.75),
                    ),
                  ),
                ],
              ),
            ),
          ),

        if (!a.consented || !a.connected) ...[
          const SectionTitle('Finish setting up'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(!a.consented ? 'Agreement not signed' : 'No broker connected',
                      style:
                          const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 7),
                  Text(
                    !a.consented
                        ? 'The agreement is recorded with a spoken video '
                            'acknowledgement, which runs on the website. Open '
                            'mnhafinancials.com and sign in to complete it.'
                        : 'Connecting a Groww account needs API keys and a '
                            'registered IP address, set up on the website.',
                    style: const TextStyle(fontSize: 13, height: 1.55),
                  ),
                ],
              ),
            ),
          ),
        ],

        const SectionTitle('More'),
        _link(context, 'Analysis', Icons.insights_outlined, const AnalysisScreen()),
        if (a.role != 'admin')
          _link(context, 'Research', Icons.science_outlined,
              ResearchScreen(isOwner: a.role == 'owner')),
        if (a.role == 'admin')
          _link(context, 'Admin console', Icons.admin_panel_settings_outlined,
              const AdminScreen()),
        _link(context, 'Legal', Icons.gavel_outlined, const LegalScreen()),

        const SectionTitle('Broker'),
        _row(context, 'Broker', a.account.broker.isEmpty ? '—' : a.account.broker),
        _row(context, 'Client code (UCC)', a.account.ucc ?? '—'),
        _row(context, 'Segments',
            a.account.segments.isEmpty ? '—' : a.account.segments.join(', ')),
        // "—" not "₹0" when unknown: an unknown balance and an empty one are
        // different facts.
        _row(context, 'Available cash', money(a.account.balance)),
        _row(context, 'Used margin', money(a.account.usedMargin)),
        _row(context, 'Order address', a.orderIp ?? 'Not set',
            color: a.orderIp == null ? T.warn : null),
        _row(context, 'Trading', a.canTrade ? 'Enabled' : 'Read-only',
            color: a.canTrade ? T.up : T.warn),

        const SectionTitle('Membership'),
        if (m == null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Panel(
              child: Text(
                'Not enrolled. Membership is the performance-fee scheme — a fee '
                'only on profit above your previous peak, never on a loss.',
                style: TextStyle(
                  fontSize: 13,
                  height: 1.5,
                  color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
            ),
          )
        else ...[
          _row(context, 'Status', '${m['status']}',
              color: m['status'] == 'active' ? T.up : null),
          _row(context, 'Fee', '${m['feePct'] ?? 0}% of profit above peak'),
          _row(context, 'High-water mark',
              moneyCompact((m['highWaterMark'] as num?)?.toDouble())),
          _row(context, 'Period ends', ago((m['periodEndsAt'] as num?)?.toInt())),
          if (a.hasDueInvoice) _row(context, 'Invoice', 'Payment due', color: T.warn),
        ],

        const SectionTitle('Identity'),
        _row(context, 'KYC', a.kycStatus,
            color: a.kycStatus == 'approved'
                ? T.up
                : a.kycStatus == 'submitted'
                    ? T.warn
                    : null),
        _row(context, 'Agreement',
            a.signedAgreement?.split(' ').first ?? 'Not signed',
            color: a.signedAgreement == null ? T.warn : null),

        const SectionTitle('Session'),
        _row(context, 'Market', a.market.label),
        _row(context, 'IST clock', a.market.clock),
        _row(context, 'Date', a.market.date),

        // Everything the website's Settings page lets a member do to their
        // own account. Two of these are rights rather than conveniences —
        // withdrawing an optional consent, and erasing the account — so the
        // app offering only Sign out was a real gap, not a cosmetic one.
        _Controls(a: a, onSignOut: onSignOut),

        const SectionTitle('Not in this app'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _Note(
                  'Placing orders',
                  'Since April 2026 an order must originate from an IP '
                      'registered with the broker. A phone has no fixed address, '
                      'so orders are placed from the desk, never here.',
                ),
                // Owner only: the Terminal is the one page in the web nav with
                // no screen here. Everything it shows does have one — the
                // chart, the chain and the working orders each have their own
                // — so what is absent is its docked order ticket, for the
                // reason just given above.
                if (me.role == 'owner') ...[
                  const SizedBox(height: 13),
                  const _Note(
                    'The Terminal',
                    'Its chart, option chain and working orders are all here, '
                        'on their own screens. What the Terminal adds is the '
                        'order ticket docked beside them, and that cannot be '
                        'used from a phone — so the page itself stays on the '
                        'desk.',
                  ),
                ],
                const SizedBox(height: 13),
                const _Note(
                  'KYC and the agreement',
                  'Both capture camera video and documents, and run on the '
                      'website so there is one record of what was signed.',
                ),
                const SizedBox(height: 13),
                const _Note(
                  'Option chain',
                  'The chain stays empty until Groww provides an Indian option '
                      'chain — Yahoo carries none, and modelling strikes locally '
                      'would print numbers no exchange ever did.',
                ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 26),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: OutlinedButton.icon(
            onPressed: onSignOut,
            icon: const Icon(Icons.logout, size: 18),
            label: const Text('Sign out'),
            style: OutlinedButton.styleFrom(
              foregroundColor: T.down,
              side: const BorderSide(color: T.down),
              minimumSize: const Size.fromHeight(48),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(3)),
            ),
          ),
        ),
        const SizedBox(height: 18),
        Center(
          child: Text(
            'MNHA Financials  ·  decision support, not advice',
            style: TextStyle(
              fontSize: 11,
              color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.4),
            ),
          ),
        ),
      ],
    );
  }

  Widget _link(BuildContext context, String label, IconData icon, Widget page) =>
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 1),
        child: Material(
          color: Theme.of(context).colorScheme.surface,
          child: InkWell(
            onTap: () =>
                Navigator.of(context).push(MaterialPageRoute(builder: (_) => page)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 13),
              child: Row(
                children: [
                  Icon(icon, size: 18, color: T.mark),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(label,
                        style: const TextStyle(
                            fontSize: 13.5, fontWeight: FontWeight.w500)),
                  ),
                  Icon(Icons.chevron_right,
                      size: 18,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.35)),
                ],
              ),
            ),
          ),
        ),
      );

  Widget _row(BuildContext context, String label, String value, {Color? color}) =>
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 1),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
          color: Theme.of(context).colorScheme.surface,
          child: Row(
            children: [
              Expanded(
                child: Text(label,
                    style: TextStyle(
                      fontSize: 13,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.65),
                    )),
              ),
              Text(value,
                  style: kNum.copyWith(
                      fontSize: 13, fontWeight: FontWeight.w600, color: color)),
            ],
          ),
        ),
      );

  Widget _tag(BuildContext context, String text, {Color? color}) {
    final c = color ?? Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(2),
      ),
      child: Text(text,
          style: TextStyle(
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: c)),
    );
  }
}

class _Note extends StatelessWidget {
  final String title;
  final String body;
  const _Note(this.title, this.body);

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(body,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.55,
                color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6),
              )),
        ],
      );
}


/// The member's own account controls — the website's Settings page.
///
/// Self-contained so the Account screen stays a simple read: this holds the
/// switch positions it has changed, and asks before anything that cannot be
/// taken back.
class _Controls extends StatefulWidget {
  final AccountInfo a;
  final VoidCallback onSignOut;
  const _Controls({required this.a, required this.onSignOut});

  @override
  State<_Controls> createState() => _ControlsState();
}

class _ControlsState extends State<_Controls> {
  late bool _marketing = widget.a.marketingOn;
  late bool _analytics = widget.a.analyticsOn;
  bool _busy = false;

  /// Runs a control and says plainly whether it worked.
  ///
  /// A bare `String?` could not: these actions answer with null on success as
  /// well as on failure, so a switch had no way to tell "the server accepted
  /// this" from "the server refused" — and a consent switch that guesses is
  /// exactly the thing that must not exist.
  Future<({bool ok, String? next})> _send(Map<String, dynamic> body) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      final next = await api.settingsAction(body);
      return (ok: true, next: next);
    } on ApiError catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
      return (ok: false, next: null);
    } catch (_) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not reach the server.')),
      );
      return (ok: false, next: null);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggle(String key, bool on) async {
    // The switch moves once the server has accepted it, not before: a control
    // that flips and then silently reverts is how someone comes to believe a
    // consent is off when it is not.
    final r = await _send({
      'action': 'optional-consent',
      'key': key,
      'value': on ? 'on' : 'off',
    });
    // Only move the switch once the server has actually taken it. A control
    // that flips first and reverts quietly is how someone comes to believe a
    // consent is off when it is still on.
    if (!r.ok || !mounted) return;
    setState(() {
      if (key == 'marketing') {
        _marketing = on;
      } else {
        _analytics = on;
      }
    });
  }

  Future<void> _disconnect() async {
    // Captured before the confirm dialog: that dialog is an await, and the
    // messenger must not be reached for through a context afterwards.
    final messenger = ScaffoldMessenger.of(context);
    if (!await _ask(
      'Disconnect Groww?',
      'MNHA stops reading your account and can place nothing. Your money and '
          'your holdings stay exactly where they are, with your broker. You '
          'can connect again whenever you like.',
      'Disconnect',
    )) {
      return;
    }
    final r = await _send({'action': 'disconnect-broker'});
    if (r.ok) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Groww disconnected.')),
      );
    }
  }

  Future<void> _delete() async {
    final messenger = ScaffoldMessenger.of(context);
    if (!await _ask(
      'Delete your account?',
      'Erases your account and the data held with it. This cannot be undone. '
          'An active membership period must be closed and any unpaid bill '
          'settled first — the server checks both.',
      'Delete my account',
      danger: true,
    )) {
      return;
    }
    final r = await _send({'action': 'delete-account'});
    if (!r.ok) return;
    // The server says what happened by WHERE it sends you: back to settings
    // with a reason means it refused, anywhere else means the account is gone.
    final next = r.next ?? '';
    if (next.contains('delete=active')) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Close your membership period first, then delete.'),
      ));
    } else if (next.contains('delete=due')) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Settle the unpaid bill first, then delete.'),
      ));
    } else {
      widget.onSignOut();
    }
  }

  Future<void> _changePassword() async {
    final cur = TextEditingController();
    final next = TextEditingController();
    final confirm = TextEditingController();
    final go = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change your password', style: TextStyle(fontSize: 17)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: cur,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Current password'),
            ),
            TextField(
              controller: next,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New password'),
            ),
            TextField(
              controller: confirm,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Repeat the new one'),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Change',
                  style: TextStyle(fontWeight: FontWeight.w600))),
        ],
      ),
    );
    if (go == true && mounted) {
      final messenger = ScaffoldMessenger.of(context);
      final r = await _send({
        'action': 'change-password',
        'current': cur.text,
        'next': next.text,
        'confirm': confirm.text,
      });
      // On failure the server's own wording is already on screen — "that
      // password is wrong" is more use than anything this could add.
      if (r.ok) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Password changed.')),
        );
      }
    }
    for (final c in [cur, next, confirm]) {
      c.dispose();
    }
  }

  Future<bool> _ask(String title, String body, String confirmLabel,
      {bool danger = false}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title, style: const TextStyle(fontSize: 17)),
        content: Text(body, style: const TextStyle(fontSize: 13.5, height: 1.45)),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(confirmLabel,
                style: TextStyle(
                    color: danger ? T.down : T.mark,
                    fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    // An env login has no stored password and no record to erase, so these
    // controls would be offered only to be refused by the server.
    final reserved = widget.a.role != 'member';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionTitle('Privacy & consents'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Panel(
            child: Column(
              children: [
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  value: _marketing,
                  onChanged: _busy || reserved
                      ? null
                      : (v) => _toggle('marketing', v),
                  title: const Text('Marketing', style: TextStyle(fontSize: 14)),
                  subtitle: const Text('Optional. Switch off at any time.',
                      style: TextStyle(fontSize: 11.5)),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  value: _analytics,
                  onChanged: _busy || reserved
                      ? null
                      : (v) => _toggle('analytics', v),
                  title: const Text('Analytics', style: TextStyle(fontSize: 14)),
                  subtitle: const Text('Optional. Switch off at any time.',
                      style: TextStyle(fontSize: 11.5)),
                ),
              ],
            ),
          ),
        ),

        if (!reserved) ...[
          const SectionTitle('Your account'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OutlinedButton(
                  onPressed: _busy ? null : _changePassword,
                  child: const Text('Change your password'),
                ),
                if (widget.a.connected) ...[
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _busy ? null : _disconnect,
                    child: const Text('Disconnect Groww'),
                  ),
                ],
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: _busy ? null : _delete,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: T.down,
                    side: const BorderSide(color: T.down),
                  ),
                  child: const Text('Delete my account'),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
