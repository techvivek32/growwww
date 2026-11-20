import 'package:flutter/material.dart';
import '../theme.dart';

/// Terms, risk disclosure, privacy and contact — the web's `/legal/*`.
///
/// Held as text in the app rather than fetched, so it is readable before
/// sign-in and without a network. These are the documents someone most wants
/// to read when deciding whether to trust the thing, which is exactly the
/// moment a loading spinner is least welcome.
///
/// The canonical versions remain on mnhafinancials.com; this is a faithful
/// summary of the same positions, not a second set of terms.
class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Legal'),
          bottom: const TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: T.mark,
            indicatorWeight: 2,
            labelStyle: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600),
            tabs: [
              Tab(text: 'Terms'),
              Tab(text: 'Risk'),
              Tab(text: 'Privacy'),
              Tab(text: 'Contact'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _Doc(_terms),
            _Doc(_risk),
            _Doc(_privacy),
            _Doc(_contact),
          ],
        ),
      ),
    );
  }
}

/// Renders a very small subset of Markdown — "## " headings and blank-line
/// paragraphs. A full Markdown package for four static documents would be a
/// dependency to audit and update for no visible gain.
class _Doc extends StatelessWidget {
  final String body;
  const _Doc(this.body);

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    final blocks = body.trim().split('\n\n');
    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 20, 18, 36),
      children: [
        for (final b in blocks)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: b.startsWith('## ')
                ? Text(
                    b.substring(3),
                    style: const TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      height: 1.3,
                    ),
                  )
                : Text(
                    b.replaceAll('\n', ' '),
                    style: TextStyle(
                      fontSize: 13.5,
                      height: 1.65,
                      color: c.onSurface.withValues(alpha: 0.78),
                    ),
                  ),
          ),
      ],
    );
  }
}

const _terms = '''
## What this is

MNHA Financials is a terminal that sits on top of your own Groww account. It
shows prices, your account, and rule-based setups derived from price and
volume data. It is decision-support tooling, not investment advice.

## Your account stays yours

Your money stays in your own Groww account. We never hold client funds, and
nothing here can move money between accounts.

## Orders

Orders route to your own Groww account. You place them, you own them. Since
April 2026 an order must originate from an IP address registered with the
broker, so orders are placed from the desk and never from a phone.

## Sessions

A session lasts eight hours and is held in a signed, httpOnly cookie. Signing
in or out never places or cancels an order.

## Setups are derived, not written

Scores, stops and targets come from the day's real range, real volume against
its 20-session average, and the real closing series. They can be wrong. A
strategy whose measured edge turns negative keeps producing signals, and the
app labels those — read the label.

## Changes

These terms may change. The canonical version is always the one published at
mnhafinancials.com.
''';

const _risk = '''
## Trading involves risk of loss

You can lose money, including more than your initial outlay when trading
derivatives. Past performance of any strategy, backtested or live, does not
predict future results.

## Backtests are not promises

A backtest is a measurement over history that has already happened. It is
fitted to conditions that will not repeat exactly. The app blends backtested
edge with live outcomes precisely because the backtest alone is not evidence.

## Signals are not recommendations

A setup is an observation that a set of rules fired. It is not a
recommendation to buy or sell, and no one at MNHA Financials knows your
circumstances, horizon or risk tolerance.

## Prices may be delayed

Market data here comes from a delayed public feed. That is adequate for
research and inadequate for execution timing. If a price could not be
fetched, the app shows a dash — never a stale number dressed as a live one.

## Derivatives

F&O carries additional leverage risk. Positions can move against you faster
than stops can be filled, and gaps can skip a stop entirely.
''';

const _privacy = '''
## What is collected

Your email address, a hashed password, and — if you connect one — the broker
credentials needed to read your account. KYC records and the consent
recording, where you have completed them.

## What is never collected

Your Groww password. The terminal connects through the broker's API using
keys you generate and can revoke at any time.

## How credentials are held

Broker keys are stored server-side and used only to make calls on your behalf.
On your phone, the session token is kept in the Android Keystore, not in plain
preferences.

## Sharing

Account data is not sold or shared. It is read by the terminal to show you
your own account, and by the admin console for support and fee settlement.

## Deletion

You can ask for your account and its records to be erased. Trade records that
must be retained for regulatory reasons are the exception, and we will say so
rather than quietly keeping them.
''';

const _contact = '''
## Support

Email the address on mnhafinancials.com. Include your account email and, for
anything about an order, the time it was placed.

## Security

If you believe you have found a security problem, report it by email before
disclosing it anywhere else. We will confirm receipt and keep you informed.

## Complaints

Describe what happened, when, and what you expected instead. Account and order
records are retained, so a specific time makes an answer much faster.

## This app

The Android app is a client for the same service. Anything it shows comes
from the same server as the website — there is one implementation of each
rule, and the app never computes its own version of a number.
''';
