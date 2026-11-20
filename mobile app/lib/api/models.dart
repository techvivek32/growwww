/// Dart mirrors of the contracts in `src/lib/types.ts` and `src/lib/api/yahoo.ts`.
///
/// Every nullable field here is nullable in the TypeScript too, and for the
/// same reason: the web app draws a hard line between "zero" and "unknown".
/// A holding whose live price did not arrive has `ltp == null`, never the
/// average cost — showing cost as though it were the market price would
/// invent a P&L of exactly zero, which is the one number guaranteed wrong.
/// Keep that distinction when rendering: `null` means say so, not show 0.
library;

double? _d(dynamic v) => v == null ? null : (v as num).toDouble();
int _i(dynamic v) => v == null ? 0 : (v as num).toInt();
double _dd(dynamic v) => v == null ? 0 : (v as num).toDouble();

class Quote {
  final String symbol;
  final String name;
  final double last;
  final double change;
  final double changePct;
  final double? dayHigh;
  final double? dayLow;
  final double? volume;
  final List<double> spark;

  /// True when this came from the committed snapshot rather than a live
  /// fetch. The UI must surface it — a stale price shown as live is the
  /// failure mode this whole field exists to prevent.
  final bool stale;
  final String? asOf;

  Quote.fromJson(Map<String, dynamic> j)
      : symbol = j['symbol'] as String,
        name = (j['name'] ?? j['symbol']) as String,
        last = _dd(j['last']),
        change = _dd(j['change']),
        changePct = _dd(j['changePct']),
        dayHigh = _d(j['dayHigh']),
        dayLow = _d(j['dayLow']),
        volume = _d(j['volume']),
        spark = ((j['spark'] ?? []) as List).map((e) => (e as num).toDouble()).toList(),
        stale = j['stale'] == true,
        asOf = j['asOf'] as String?;
}

class Holding {
  final String symbol;
  final String company;
  final int qty;
  final double avg;
  final double? ltp;
  final double? dayPct;

  Holding.fromJson(Map<String, dynamic> j)
      : symbol = j['symbol'] as String,
        company = (j['company'] ?? j['symbol']) as String,
        qty = _i(j['qty']),
        avg = _dd(j['avg']),
        ltp = _d(j['ltp']),
        dayPct = _d(j['dayPct']);

  /// Null when there is no live price — not zero. See the note at the top.
  double? get value => ltp == null ? null : ltp! * qty;
  double? get pnl => ltp == null ? null : (ltp! - avg) * qty;
  double? get pnlPct => ltp == null || avg == 0 ? null : ((ltp! - avg) / avg) * 100;
}

class Position {
  final String symbol;
  final String product;
  final String side;
  final int qty;
  final double avg;
  final double? ltp;
  final double realised;

  Position.fromJson(Map<String, dynamic> j)
      : symbol = j['symbol'] as String,
        product = (j['product'] ?? '') as String,
        side = (j['side'] ?? 'BUY') as String,
        qty = _i(j['qty']),
        avg = _dd(j['avg']),
        ltp = _d(j['ltp']),
        realised = _dd(j['realised']);

  double? get unrealised {
    if (ltp == null) return null;
    final dir = side == 'SELL' ? -1 : 1;
    return (ltp! - avg) * qty * dir;
  }
}

class Order {
  final String id;
  final String? date;
  final String time;
  final String symbol;
  final String side;
  final String type;
  final String product;
  final int qty;
  final int filled;
  final double? price;
  final double? avg;
  final String status;
  final String? note;

  Order.fromJson(Map<String, dynamic> j)
      : id = (j['id'] ?? '') as String,
        date = j['date'] as String?,
        time = (j['time'] ?? '') as String,
        symbol = (j['symbol'] ?? '') as String,
        side = (j['side'] ?? 'BUY') as String,
        type = (j['type'] ?? '') as String,
        product = (j['product'] ?? '') as String,
        qty = _i(j['qty']),
        filled = _i(j['filled']),
        price = _d(j['price']),
        avg = _d(j['avg']),
        status = (j['status'] ?? '') as String,
        note = j['note'] as String?;
}

class Trade {
  final String id;
  final String date;
  final String symbol;
  final String company;
  final String side;
  final int qty;
  final double entry;
  final double exit;

  /// Null by design: Groww's order payload carries no per-trade charges, and
  /// an account-level figure divided by trade count is a guess, not a fact.
  final double? charges;

  Trade.fromJson(Map<String, dynamic> j)
      : id = (j['id'] ?? '') as String,
        date = (j['date'] ?? '') as String,
        symbol = (j['symbol'] ?? '') as String,
        company = (j['company'] ?? j['symbol'] ?? '') as String,
        side = (j['side'] ?? 'BUY') as String,
        qty = _i(j['qty']),
        entry = _dd(j['entry']),
        exit = _dd(j['exit']),
        charges = _d(j['charges']);

  double get pnl => (exit - entry) * qty * (side == 'SELL' ? -1 : 1);
}

class StockAlert {
  final String symbol;
  final String company;
  final double score;
  final String timeframe;
  final double last;
  final double changePct;
  final double entry;
  final double target;
  final double stop;
  final double rr;
  final double? rsi;
  final double? volX;
  final List<String> tags;
  final List<double> spark;

  StockAlert.fromJson(Map<String, dynamic> j)
      : symbol = j['symbol'] as String,
        company = (j['company'] ?? j['symbol']) as String,
        score = _dd(j['score']),
        timeframe = (j['timeframe'] ?? '') as String,
        last = _dd(j['last']),
        changePct = _dd(j['changePct']),
        entry = _dd(j['entry']),
        target = _dd(j['target']),
        stop = _dd(j['stop']),
        rr = _dd(j['rr']),
        rsi = _d(j['rsi']),
        volX = _d(j['volX']),
        tags = ((j['tags'] ?? []) as List).map((e) => e.toString()).toList(),
        spark = ((j['spark'] ?? []) as List).map((e) => (e as num).toDouble()).toList();
}

class Account {
  final String name;
  final String email;
  final String broker;
  final double? balance;
  final double? usedMargin;
  final String? ucc;
  final List<String> segments;

  Account.fromJson(Map<String, dynamic> j)
      : name = (j['name'] ?? '') as String,
        email = (j['email'] ?? '') as String,
        broker = (j['broker'] ?? '') as String,
        balance = _d(j['balance']),
        usedMargin = _d(j['usedMargin']),
        ucc = j['ucc'] as String?,
        segments = ((j['segments'] ?? []) as List).map((e) => e.toString()).toList();
}

class MarketState {
  final String phase;
  final String label;
  final String clock;
  final String date;
  final bool isLive;

  MarketState.fromJson(Map<String, dynamic> j)
      : phase = (j['phase'] ?? 'closed') as String,
        label = (j['label'] ?? '') as String,
        clock = (j['clock'] ?? '') as String,
        date = (j['date'] ?? '') as String,
        isLive = j['isLive'] == true;
}

class Me {
  final String userId;
  final String role;
  final Account account;
  final MarketState market;
  final bool canTrade;
  final bool connected;

  /// Cash + holdings + their sum. Null when no broker is attached — which is
  /// not the same as zero, and the home screen renders the difference.
  final NavReading? nav;

  /// The address this account's orders are sent from, once one is reserved.
  /// Null means orders would be refused by the broker, so the home screen
  /// says so rather than leaving the row blank.
  final String? orderIp;

  Me.fromJson(Map<String, dynamic> j)
      : userId = (j['userId'] ?? '') as String,
        role = (j['role'] ?? 'member') as String,
        account = Account.fromJson(j['account'] as Map<String, dynamic>),
        market = MarketState.fromJson(j['market'] as Map<String, dynamic>),
        canTrade = j['canTrade'] == true,
        connected = (j['connection']?['live'] == true),
        nav = j['nav'] == null ? null : NavReading.fromJson(j['nav'] as Map<String, dynamic>),
        orderIp = j['connection']?['orderIp'] as String?;

  bool get isOwner => role == 'owner';
}

class Watchlist {
  final String id;
  final String name;
  final List<String> symbols;

  /// Parallel to [symbols]; an entry is null when no quote came back for that
  /// symbol. The row still renders — dropping a symbol the user added would
  /// be worse than a blank price beside it.
  final List<Quote?> quotes;

  Watchlist.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        name = (j['name'] ?? '') as String,
        symbols = ((j['symbols'] ?? []) as List).map((e) => e.toString()).toList(),
        quotes = ((j['quotes'] ?? []) as List)
            .map((e) => e == null ? null : Quote.fromJson(e as Map<String, dynamic>))
            .toList();
}

/// Cash + holdings + their sum, as `broker.getNav()` returns it.
class NavReading {
  final double cash;
  final double holdings;
  final double nav;

  NavReading.fromJson(Map<String, dynamic> j)
      : cash = _dd(j['cash']),
        holdings = _dd(j['holdings']),
        nav = _dd(j['nav']);
}

class EngineStatus {
  final bool running;
  final bool scanning;
  final int? lastScan;
  final int? lastBacktest;
  final int strategyCount;

  /// Running AND the market is live. Kept distinct from [running] because
  /// "Running" on a Sunday would imply signals are being produced when the
  /// loop is deliberately idle.
  final bool working;

  EngineStatus.fromJson(Map<String, dynamic> j)
      : running = j['running'] == true,
        scanning = j['scanning'] == true,
        lastScan = (j['lastScan'] as num?)?.toInt(),
        lastBacktest = (j['lastBacktest'] as num?)?.toInt(),
        strategyCount = _i(j['strategyCount']),
        working = j['working'] == true;
}

/// One strategy's measured performance. [edge] is the blended backtest-plus-
/// live verdict; the board acts only on strategies where it holds.
class Scorecard {
  final String strategy;
  final String label;
  final String description;
  final int liveResolved;
  final int liveOpen;
  final double? liveWinRate;
  final double? liveExpectancy;
  final double? blendedExpectancy;
  final bool edge;

  Scorecard.fromJson(Map<String, dynamic> j)
      : strategy = (j['strategy'] ?? '') as String,
        label = (j['label'] ?? j['strategy'] ?? '') as String,
        description = (j['description'] ?? '') as String,
        liveResolved = _i(j['liveResolved']),
        liveOpen = _i(j['liveOpen']),
        liveWinRate = _d(j['liveWinRate']),
        liveExpectancy = _d(j['liveExpectancy']),
        blendedExpectancy = _d(j['blendedExpectancy']),
        edge = j['edge'] == true;
}

/// An open journal signal, carrying whether its strategy currently has a
/// measured edge. Render [edge] wherever the signal appears — an unlabelled
/// signal from a retired strategy reads as an endorsement.
class TaggedSignal {
  final String id;
  final String symbol;
  final String segment;
  final String strategy;
  final String stratLabel;
  final String? side;
  final double? entry;
  final double? stop;
  final double? target;
  final double? rr;
  final String reason;
  final int createdAt;
  final String status;
  final bool edge;

  TaggedSignal.fromJson(Map<String, dynamic> j)
      : id = (j['id'] ?? '') as String,
        symbol = (j['symbol'] ?? '') as String,
        segment = (j['segment'] ?? '') as String,
        strategy = (j['strategy'] ?? '') as String,
        stratLabel = (j['stratLabel'] ?? j['strategy'] ?? '') as String,
        side = j['side'] as String?,
        entry = _d(j['entry']),
        stop = _d(j['stop']),
        target = _d(j['target']),
        rr = _d(j['rr']),
        reason = (j['reason'] ?? '') as String,
        createdAt = _i(j['createdAt']),
        status = (j['status'] ?? '') as String,
        edge = j['edge'] == true;
}

class AiDesk {
  final EngineStatus engine;
  final MarketState market;
  final NavReading? nav;
  final List<Scorecard> scorecards;
  final List<TaggedSignal> signals;

  AiDesk.fromJson(Map<String, dynamic> j)
      : engine = EngineStatus.fromJson(j['engine'] as Map<String, dynamic>),
        market = MarketState.fromJson(j['market'] as Map<String, dynamic>),
        nav = j['nav'] == null ? null : NavReading.fromJson(j['nav'] as Map<String, dynamic>),
        scorecards = ((j['scorecards'] ?? []) as List)
            .map((e) => Scorecard.fromJson(e as Map<String, dynamic>))
            .toList(),
        signals = ((j['signals'] ?? []) as List)
            .map((e) => TaggedSignal.fromJson(e as Map<String, dynamic>))
            .toList();
}

class Notif {
  final String id;
  final String title;
  final String body;
  final int createdAt;
  final bool read;

  Notif.fromJson(Map<String, dynamic> j)
      : id = (j['id'] ?? '') as String,
        title = (j['title'] ?? '') as String,
        body = (j['body'] ?? '') as String,
        createdAt = _i(j['createdAt']),
        read = j['read'] == true;
}

/// Account, broker, membership and the KYC/consent gates in one read — what
/// the web splits across /settings, /membership and /broker.
class AccountInfo {
  final Account account;
  final String role;
  final bool connected;
  final bool canTrade;
  final bool ipPinned;
  final String? orderIp;
  final bool credentials;
  final NavReading? nav;
  final Map<String, dynamic>? membership;
  final List<Map<String, dynamic>> invoices;
  final bool hasDueInvoice;
  final bool consented;
  final String kycStatus;
  final int unread;
  final MarketState market;

  /// The agreement version this account signed, and whether a newer one is
  /// on offer. An older-but-still-accepted signature is NOT blocked, so the
  /// UI presents this as an invitation and never as a gate.
  final String? signedAgreement;
  final bool agreementUpdateOffered;
  final String currentAgreement;

  AccountInfo.fromJson(Map<String, dynamic> j)
      : account = Account.fromJson(j['account'] as Map<String, dynamic>),
        role = (j['role'] ?? 'member') as String,
        connected = j['broker']?['connected'] == true,
        canTrade = j['broker']?['canTrade'] == true,
        ipPinned = j['broker']?['ipPinned'] == true,
        orderIp = j['broker']?['orderIp'] as String?,
        credentials = j['broker']?['credentials'] == true,
        nav = j['nav'] == null ? null : NavReading.fromJson(j['nav'] as Map<String, dynamic>),
        membership = j['membership'] as Map<String, dynamic>?,
        invoices = ((j['invoices'] ?? []) as List).cast<Map<String, dynamic>>(),
        hasDueInvoice = j['hasDueInvoice'] == true,
        consented = j['consented'] == true,
        kycStatus = (j['kyc']?['status'] ?? 'none').toString(),
        unread = _i(j['unread']),
        market = MarketState.fromJson(j['market'] as Map<String, dynamic>),
        signedAgreement = j['agreement']?['signedVersion'] as String?,
        agreementUpdateOffered = j['agreement']?['updateOffered'] == true,
        currentAgreement = (j['agreement']?['current'] ?? '') as String;
}

/// A price series for the chart. `points` is close-only — the web chart draws
/// a line, not candles, and sending OHLC would quadruple the payload for
/// pixels nobody renders.
class ChartSeries {
  final List<double> points;
  final List<int> times;

  ChartSeries.fromJson(Map<String, dynamic> j)
      : points = ((j['points'] ?? j['closes'] ?? []) as List)
            .map((e) => (e as num).toDouble())
            .toList(),
        times = ((j['times'] ?? []) as List).map((e) => (e as num).toInt()).toList();
}

class StockDetail {
  final Quote quote;
  final ChartSeries? series;
  final String range;
  final List<String> ranges;

  /// Null when this account does not hold it. Shown on the price screen so
  /// "do I own this, and at what cost" does not need a second screen.
  final Holding? holding;
  final Position? position;

  StockDetail.fromJson(Map<String, dynamic> j)
      : quote = Quote.fromJson(j['quote'] as Map<String, dynamic>),
        series = j['series'] == null
            ? null
            : ChartSeries.fromJson(j['series'] as Map<String, dynamic>),
        range = (j['range'] ?? '3M') as String,
        ranges = ((j['ranges'] ?? []) as List).map((e) => e.toString()).toList(),
        holding = j['holding'] == null
            ? null
            : Holding.fromJson(j['holding'] as Map<String, dynamic>),
        position = j['position'] == null
            ? null
            : Position.fromJson(j['position'] as Map<String, dynamic>);
}

class AllocationRow {
  final String symbol;
  final String company;
  final double value;
  final double pct;
  final double pnl;

  AllocationRow.fromJson(Map<String, dynamic> j)
      : symbol = (j['symbol'] ?? '') as String,
        company = (j['company'] ?? '') as String,
        value = _dd(j['value']),
        pct = _dd(j['pct']),
        pnl = _dd(j['pnl']);
}

class Analysis {
  final bool connected;
  final double invested;
  final double current;
  final double unrealised;
  final double? unrealisedPct;
  final double realisedGross;
  final int tradeCount;
  final int wins;
  final double? winRate;
  final List<AllocationRow> allocation;
  final double? topWeightPct;
  final int openPositions;
  final int holdingsCount;

  /// How many holdings actually had a live price. When this is below
  /// [holdingsCount] the totals above exclude the difference, and the screen
  /// says so rather than quietly counting a missing price as zero.
  final int pricedCount;

  Analysis.fromJson(Map<String, dynamic> j)
      : connected = j['connected'] == true,
        invested = _dd(j['invested']),
        current = _dd(j['current']),
        unrealised = _dd(j['unrealised']),
        unrealisedPct = _d(j['unrealisedPct']),
        realisedGross = _dd(j['realisedGross']),
        tradeCount = _i(j['tradeCount']),
        wins = _i(j['wins']),
        winRate = _d(j['winRate']),
        allocation = ((j['allocation'] ?? []) as List)
            .map((e) => AllocationRow.fromJson(e as Map<String, dynamic>))
            .toList(),
        topWeightPct = _d(j['topWeightPct']),
        openPositions = _i(j['openPositions']),
        holdingsCount = _i(j['holdingsCount']),
        pricedCount = _i(j['pricedCount']);
}
