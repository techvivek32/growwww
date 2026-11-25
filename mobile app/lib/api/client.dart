import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../env.dart';
import 'models.dart';

/// Thrown for anything the user should be told about. [unauthorised] is
/// separated out because it is the one case the app reacts to structurally —
/// by signing out — rather than by showing a message.
class ApiError implements Exception {
  final String message;
  final int status;
  ApiError(this.message, this.status);
  bool get unauthorised => status == 401 || status == 403;
  @override
  String toString() => message;
}

/// The one HTTP client for the app.
///
/// ## Why the session is a cookie
///
/// The server resolves the acting user through `session.currentUserId()`,
/// which reads the `mnha_session` cookie — and in `broker.ts` that lookup is
/// the per-user data boundary. A bearer token would be more idiomatic here,
/// but the server-side code that enforces the boundary cannot see one. So the
/// app holds the same signed token a browser would and presents it the same
/// way. It is HMAC-signed and expires in 8 hours; the app cannot forge or
/// extend it.
///
/// The token lives in [FlutterSecureStorage] (Android Keystore), not in
/// SharedPreferences. It is a live trading session, so it belongs somewhere
/// another app on a rooted device cannot simply read.
class Api {
  /// Chosen at BUILD time from `env/*.json` via `--dart-define`, defaulting
  /// to production. Deliberately not a runtime setting with a text field: a
  /// trading app whose server address can be retyped is one social-engineering
  /// message from a credential harvester. A live build has no code path to
  /// any other host — see lib/env.dart.
  static const base = Env.apiBase;

  // Defaults are what we want on v11: AES-GCM with the key held in the
  // Android Keystore. (The `encryptedSharedPreferences` flag that older
  // guides pass was removed in v11 — encryption is no longer opt-in.)
  static const _storage = FlutterSecureStorage();
  static const _key = 'mnha_session';

  String? _token;

  /// Restores a session from a previous launch. Returns false when there is
  /// none, or when it has expired (the server is the judge of that — this
  /// only checks presence; [me] is what proves it still works).
  Future<bool> restore() async {
    _token = await _storage.read(key: _key);
    return _token != null;
  }

  Future<void> _save(String token) async {
    _token = token;
    await _storage.write(key: _key, value: token);
  }

  Future<void> signOut() async {
    _token = null;
    await _storage.delete(key: _key);
  }

  bool get hasSession => _token != null;

  Map<String, String> get _headers => {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        if (_token != null) 'Cookie': '$_key=$_token',
      };

  Never _raise(http.Response r) {
    String msg;
    try {
      msg = (jsonDecode(r.body) as Map<String, dynamic>)['error']?.toString() ??
          'Request failed (${r.statusCode}).';
    } catch (_) {
      // A redirect to the HTML sign-in page lands here: the body is a page,
      // not JSON. That means the session is gone, whatever the status says.
      msg = r.statusCode == 200
          ? 'Signed out. Please sign in again.'
          : 'Request failed (${r.statusCode}).';
    }
    throw ApiError(msg, r.statusCode == 200 ? 401 : r.statusCode);
  }

  Future<Map<String, dynamic>> _get(String path) async {
    final r = await http
        .get(Uri.parse('$base$path'), headers: _headers)
        // The proxy answers an expired session with a 307 to /login. Following
        // it would hand back an HTML page with a 200, which is far more
        // confusing than seeing the redirect itself.
        .timeout(const Duration(seconds: 30));

    if (r.statusCode == 307 || r.statusCode == 302) {
      throw ApiError('Your session has expired. Please sign in again.', 401);
    }
    if (r.statusCode != 200) _raise(r);
    try {
      return jsonDecode(r.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiError('Your session has expired. Please sign in again.', 401);
    }
  }

  /// The raw bytes of a stored file — a consent selfie, an ID photo, a KYC
  /// document. These endpoints answer with the file itself rather than JSON,
  /// so they cannot go through [_get].
  ///
  /// The web console links straight to these URLs because the browser already
  /// holds the session cookie. A phone cannot do that: handing the URL to the
  /// device browser would send a request with no session and show the admin a
  /// redirect to the login page instead of the document. So the app fetches
  /// the bytes on the session it already has and renders them itself.
  Future<Uint8List> fileBytes(String path) async {
    final r = await http
        .get(Uri.parse('$base$path'), headers: _headers)
        .timeout(const Duration(seconds: 45));
    if (r.statusCode == 307 || r.statusCode == 302) {
      throw ApiError('Your session has expired. Please sign in again.', 401);
    }
    if (r.statusCode == 404) {
      throw ApiError('That file is no longer stored.', 404);
    }
    if (r.statusCode != 200) _raise(r);
    return r.bodyBytes;
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final r = await http
        .post(Uri.parse('$base$path'), headers: _headers, body: jsonEncode(body))
        .timeout(const Duration(seconds: 30));
    if (r.statusCode != 200) _raise(r);
    return jsonDecode(r.body) as Map<String, dynamic>;
  }

  // ---- auth ---------------------------------------------------------------

  /// Returns the path the server says this account should land on, mirroring
  /// the web's post-login routing: /consent when the agreement is unsigned,
  /// /connect-broker when no broker is attached, otherwise the desk.
  Future<String> login(String email, String password) async {
    final j = await _post('/api/mobile/login', {'email': email, 'password': password});
    await _save(j['token'] as String);
    return (j['next'] ?? '/ai') as String;
  }

  // ---- reads --------------------------------------------------------------

  Future<Me> me() async => Me.fromJson(await _get('/api/mobile/me'));

  Future<({List<Quote> quotes, MarketState market})> indices() async {
    final j = await _get('/api/mobile/indices');
    return (
      quotes: (j['quotes'] as List).map((e) => Quote.fromJson(e as Map<String, dynamic>)).toList(),
      market: MarketState.fromJson(j['market'] as Map<String, dynamic>),
    );
  }

  Future<List<StockAlert>> alerts() async {
    final j = await _get('/api/mobile/alerts');
    return (j['alerts'] as List)
        .map((e) => StockAlert.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<({bool connected, List<Holding> holdings, List<Position> positions})> portfolio() async {
    final j = await _get('/api/mobile/portfolio');
    return (
      connected: j['connected'] == true,
      holdings:
          (j['holdings'] as List).map((e) => Holding.fromJson(e as Map<String, dynamic>)).toList(),
      positions:
          (j['positions'] as List).map((e) => Position.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<({bool connected, List<Order> orders, List<Trade> trades})> orders({
    bool history = false,
  }) async {
    final j = await _get('/api/mobile/orders${history ? '?history=1' : ''}');
    return (
      connected: j['connected'] == true,
      orders: (j['orders'] as List).map((e) => Order.fromJson(e as Map<String, dynamic>)).toList(),
      trades: ((j['trades'] ?? []) as List)
          .map((e) => Trade.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// One instrument: quote, chart series, and whether this account holds it.
  Future<StockDetail> stock(String symbol, {String range = '3M'}) async =>
      StockDetail.fromJson(await _get('/api/mobile/stock?symbol=$symbol&range=$range'));

  Future<Analysis> analysis() async =>
      Analysis.fromJson(await _get('/api/mobile/analysis'));

  /// Owner research sections: scanner | backtest | chain | linked.
  /// Returned loosely typed because each view is a different table and the
  /// screens render them as tables rather than as domain objects.
  Future<Map<String, dynamic>> research(String view, {String? underlying}) async => _get(
        '/api/mobile/research?view=$view${underlying == null ? '' : '&underlying=$underlying'}',
      );

  /// Admin console: overview | members | fees | orders | access.
  /// Answers 403 for any non-admin session — the server is the boundary.
  /// Run one of the admin console's write actions.
  ///
  /// The server hands these to the very same server actions the website's
  /// forms post to, so an act done from the phone and the same act done from
  /// a desk are not two code paths that can disagree.
  ///
  /// Those actions return nothing and simply decline a request that fails
  /// their own checks, so this cannot report success on its own. The caller
  /// reloads the section afterwards and shows whatever the record now says.
  Future<void> adminAction(Map<String, dynamic> body) async {
    await _post('/api/mobile/admin', body);
  }

  /// One of the member's own account controls.
  ///
  /// Returns the path the server wants the app to go to next, or null when
  /// there is nowhere to go. Two of these answer by redirecting on the web —
  /// disconnecting lands on /connect-broker, and a refused deletion comes
  /// back with a reason — so that destination IS the result, not decoration.
  Future<String?> settingsAction(Map<String, dynamic> body) async {
    final j = await _post('/api/mobile/settings', body);
    return j['next'] as String?;
  }

  Future<Map<String, dynamic>> admin(String view) async =>
      _get('/api/mobile/admin?view=$view');

  /* ---- registration ------------------------------------------------- */

  /// Step 1. Returns the pending token and the masked address the code went
  /// to. An already-registered address answers identically, so this cannot
  /// be used to discover which addresses exist.
  Future<({String token, String maskedEmail})> signupStart(
    String email,
    String password,
  ) async {
    final j = await _post('/api/mobile/signup', {
      'step': 'start',
      'email': email,
      'password': password,
    });
    return (token: j['token'] as String, maskedEmail: (j['maskedEmail'] ?? '') as String);
  }

  /// Step 2. On success the account exists and this session is signed in.
  Future<String> signupVerify(String token, String code) async {
    final j = await _post('/api/mobile/signup', {
      'step': 'verify',
      'token': token,
      'code': code,
    });
    await _save(j['token'] as String);
    return (j['next'] ?? '/consent') as String;
  }

  Future<void> signupResend(String token) async =>
      await _post('/api/mobile/signup', {'step': 'resend', 'token': token});

  Future<AccountInfo> account() async =>
      AccountInfo.fromJson(await _get('/api/mobile/account'));

  Future<({List<Notif> items, int unread})> notifications() async {
    final j = await _get('/api/mobile/notifications');
    return (
      items: (j['items'] as List).map((e) => Notif.fromJson(e as Map<String, dynamic>)).toList(),
      unread: (j['unread'] as num?)?.toInt() ?? 0,
    );
  }

  Future<void> markNotificationsRead() async =>
      await _post('/api/mobile/notifications', const {});

  /// Whether the server holds a Firebase key and can actually deliver a push.
  /// Asked before the permission prompt — see the note in push.dart about
  /// Android only ever asking once.
  Future<bool> pushAvailable() async {
    final j = await _get('/api/mobile/push');
    return j['available'] == true;
  }

  /// Bind this device's FCM token to the signed-in account. The server takes
  /// the account from the session, never from anything sent here.
  Future<void> pushRegister(String token, {String? appVersion}) async =>
      await _post('/api/mobile/push', {
        'token': token,
        'platform': 'android',
        'appVersion': ?appVersion,
      });

  /// Revoke this device, so a signed-out phone stops receiving the account's
  /// notices.
  Future<void> pushUnregister(String token) async =>
      await _post('/api/mobile/push', {'token': token, 'action': 'unregister'});

  Future<List<Watchlist>> watchlists() async {
    final j = await _get('/api/mobile/watchlist');
    return (j['lists'] as List).map((e) => Watchlist.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<Watchlist>> editWatchlist(String listId, String symbol, String action) async {
    final j = await _post('/api/mobile/watchlist', {
      'listId': listId,
      'symbol': symbol,
      'action': action,
    });
    return (j['lists'] as List).map((e) => Watchlist.fromJson(e as Map<String, dynamic>)).toList();
  }
}

/// One instance, created at startup. Deliberately not a singleton behind a
/// static getter: tests and a future second environment should be able to
/// construct their own.
final api = Api();

/// Debug-only logging that is compiled out of a release build.
void logd(Object? o) {
  if (kDebugMode) debugPrint('[mnha] $o');
}
