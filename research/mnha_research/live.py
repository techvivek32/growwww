"""Live PAPER trading of the 09:20 intraday short rule on real market data.

NO ORDER IS EVER SENT. This module only reads market data and writes its own tables.

Every trading day:
  * `prepare` (before 09:00 IST):
    - brings the daily and 5-minute bars up to the last session;
    - brings in NSE delivery and open interest;
    - makes sure this year's frozen models exist.
  * `decide` (09:20 IST):
    - fetches today's first 5-minute bar (09:15–09:20) for the liquid F&O stocks;
    - builds the same features as the backtest (`lab.F_STAGE2`), scores them with the frozen models;
    - stores every candidate's features and score, the picks of each book, the time the decision was stored,
      and the live last-traded price of the picks at that moment.
  * `settle` (after 15:15 IST):
    - fetches the day's 5-minute bars;
    - prices every book exactly like the backtest: entry at the 09:20 bar close, a stop inside a bar fills at
      the stop or the worse open, the market stop, exit at the 15:15 bar close;
    - charges tick-aware slippage (at least 3 bps or half a tick) and Groww intraday costs.
    - It also prices the same trades from the live price at decision time, which is closer to what a real
      order placed at that moment could have got.

The models follow the backtest's yearly walk-forward. The models used in year Y were fitted on every session
before 1 January Y:
  * stage 1: daytrade's open-time model;
  * stage 2: the lab baseline's 09:20 model on `lab.F_STAGE2`.
So a live day in 2026 is scored exactly as the backtest scored 2026, and `parity()` checks this on past days.
"""

from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import math
import threading
import time

import joblib
import numpy as np
import pandas as pd
from numba import njit
from sklearn.ensemble import HistGradientBoostingRegressor

from . import config, daytrade as dtm, db, ingest, lab, pit
from .costs import trade_costs
from .groww import Groww, GrowwError
from .series import load_frame
from .sessions import ist_day, ist_minute
from .validation import day_to_date

LIVE = config.DATA / "live"
BOOK = 500_000.0
SEED = config.SEED  # the lab baseline's seed
CANDIDATES = 200  # most liquid members fetched at 09:20 (the model keeps the top 150 by liquidity)
FETCH_WORKERS = 6
MIN_ROWS = dtm.MIN_NAMES
MAX_ABS_GAP = 0.20  # a larger open-vs-yesterday move is a corporate action not yet in the stored history
BOOKS = {
    # the rule the user asked to test: the whole book short in the lowest score, held to 15:15
    "k1": {"k": 1, "stop": 0.0, "mstop": 0.0},
    # the same pick, with a 3% stop and a 0.5% market stop (cover when the average stock is up 0.5% since 09:20)
    "k1_stops": {"k": 1, "stop": 0.03, "mstop": 0.005},
    # the baseline: three shorts of Rs 1.67L each
    "k3": {"k": 3, "stop": 0.0, "mstop": 0.0},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS live_days (
  day INTEGER PRIMARY KEY, status TEXT NOT NULL, model_year INTEGER, decided_at REAL, settled_at REAL,
  bars_ready_at REAL, n_rows INTEGER, info TEXT
);
CREATE TABLE IF NOT EXISTS live_rows (
  day INTEGER NOT NULL, symbol TEXT NOT NULL, score REAL, features TEXT NOT NULL,
  PRIMARY KEY (day, symbol)
);
CREATE TABLE IF NOT EXISTS live_picks (
  day INTEGER NOT NULL, book TEXT NOT NULL, rank INTEGER NOT NULL, symbol TEXT NOT NULL, side INTEGER NOT NULL,
  score REAL NOT NULL, px_0920 REAL, ltp REAL, ltp_at REAL,
  PRIMARY KEY (day, book, symbol)
);
CREATE TABLE IF NOT EXISTS live_trades (
  day INTEGER NOT NULL, book TEXT NOT NULL, fill TEXT NOT NULL, symbol TEXT NOT NULL, side INTEGER NOT NULL,
  qty REAL NOT NULL, entry REAL NOT NULL, exit REAL NOT NULL, exit_bar INTEGER NOT NULL, why INTEGER NOT NULL,
  gross REAL NOT NULL, costs REAL NOT NULL, net REAL NOT NULL,
  PRIMARY KEY (day, book, fill, symbol)
);
"""
WHY = {0: "time 15:15", 1: "stop", 5: "market stop"}


def _db():
    db.migrate()
    con = db.connect()
    con.executescript(SCHEMA)
    return con


def log(msg: str) -> None:
    ist = dt.datetime.fromtimestamp(time.time() + config.IST_OFFSET_S, dt.timezone.utc)
    print(f"[{ist:%Y-%m-%d %H:%M:%S} IST] {msg}", flush=True)


def today_ist(now: float | None = None) -> int:
    return int(((now or time.time()) + config.IST_OFFSET_S) // 86_400)


def minute_ist(now: float | None = None) -> float:
    return (((now or time.time()) + config.IST_OFFSET_S) % 86_400) / 60.0


# ------------------------------------------------------------ models
def model_path(year: int):
    return config.MODELS / f"live_{year}.joblib"


def train(year: int | None = None) -> dict:
    """Fit and freeze the two models used for `year`, both on every session before 1 January `year`.
    Stage 2 needs the lab panel (lab.build), whose s1 column is daytrade's out-of-sample score."""
    Y = year or day_to_date(today_ist()).year
    t0 = time.time()
    d = dtm.load()
    des = dtm.design(d)
    years = np.array([day_to_date(int(x)).year for x in d["p"].days])
    rows = np.nonzero(des["elig"].any(axis=1) & (years < Y))[0]
    X, ii, jj = dtm.matrix(des, rows)
    yv = des["y_dm"][rows[ii], jj]
    m = np.isfinite(yv)
    s1 = dtm._model(config.SEED).fit(X[m], yv[m])
    L = lab.load(final=True)
    y2 = lab.demean(L, lab.ret(L, 0, lab.NB - 1))
    X2 = lab.matrix(L, lab.F_STAGE2)
    ok = (L.year < Y) & np.isfinite(y2)
    s2 = HistGradientBoostingRegressor(**dtm.HGB2, early_stopping=False, random_state=SEED).fit(X2[ok], y2[ok])
    meta = {"year": Y, "trained_at": time.time(), "stage1_rows": int(m.sum()), "stage2_rows": int(ok.sum()),
            "daily_last_day": day_to_date(int(d["p"].days[-1])).isoformat(), "f_stage2": lab.F_STAGE2,
            "data_version": d["data_version"]}
    config.ensure_dirs()
    joblib.dump({"stage1": s1, "stage2": s2, "meta": meta}, model_path(Y))
    log(f"live models for {Y}: stage 1 on {m.sum()} rows, stage 2 on {ok.sum()} rows ({time.time() - t0:.0f}s)")
    return meta


def load_models(year: int) -> dict:
    p = model_path(year)
    if not p.exists():
        raise FileNotFoundError(f"no live models for {year} — run `python -m mnha_research live-train`")
    return joblib.load(p)


# ------------------------------------------------------------ data
def first_bar_volume_history(symbols: list[str], before_day: int, n: int = 20) -> dict[str, float]:
    """Mean volume of the 09:15 bar over the symbol's last `n` sessions before `before_day` (at least 10),
    the denominator of lab's first_relvol."""
    out = {}
    for s in symbols:
        x = load_frame(s, 5)
        if x is None or x.empty:
            continue
        t = x["time"].to_numpy(dtype=np.int64)
        d, m = ist_day(t), ist_minute(t)
        first = (m == config.SESSION_OPEN) & (d < before_day)
        # a session counts only if its first bar is the 09:15 bar (as in lab.build)
        days_all, start = np.unique(d[d < before_day], return_index=True)
        ok_days = set(days_all[m[d < before_day][start] == config.SESSION_OPEN].tolist())
        v = pd.Series(x["volume"].to_numpy()[first], index=d[first])
        v = v[v.index.isin(ok_days)].iloc[-n:]
        if len(v) >= 10:
            out[s] = float(v.mean())
    return out


_local = threading.local()


def _client() -> Groww:
    """One client per worker thread (each throttles itself); the token is minted once beforehand."""
    if getattr(_local, "g", None) is None:
        _local.g = Groww()
    return _local.g


def fetch_today(symbols: list[str], day: dt.date, workers: int = FETCH_WORKERS) -> dict[str, pd.DataFrame]:
    """Today's 5-minute bars per symbol (backtesting endpoint: per-bar volume, like the stored history)."""
    out: dict[str, pd.DataFrame] = {}
    Groww().token()  # mint (or load) the access token before the threads start
    gsym = {s: ingest.groww_symbol(s) for s in symbols}

    def one(s):
        try:
            bars = _client().candles_bt(gsym[s], 5, day, day)
        except GrowwError as e:
            return s, None, str(e)[:200]
        if not bars:
            return s, None, "no bars"
        return s, pd.DataFrame([b.__dict__ for b in bars]), None

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for s, df, _err in ex.map(one, symbols):
            if df is not None:
                out[s] = df
    return out


def first_bar(df: pd.DataFrame, day: int) -> dict | None:
    t = df["time"].to_numpy(dtype=np.int64)
    k = np.nonzero((ist_day(t) == day) & (ist_minute(t) == config.SESSION_OPEN))[0]
    if not len(k):
        return None
    r = df.iloc[int(k[0])]
    o, h, l, c, v = (float(r[c_]) for c_ in ("open", "high", "low", "close", "volume"))
    if not (o > 0 and c > 0 and h >= l and h >= max(o, c) - 1e-9 and l <= min(o, c) + 1e-9):
        return None
    return {"o": o, "h": h, "l": l, "c": c, "v": v}


def paths(df: pd.DataFrame, day: int) -> np.ndarray | None:
    """(5, NB) o/h/l/c/v of the day's bars 09:15..15:10, missing bars carried forward as in lab.build."""
    t = df["time"].to_numpy(dtype=np.int64)
    sel = ist_day(t) == day
    b = (ist_minute(t[sel]) - config.SESSION_OPEN) // 5
    k = (b >= 0) & (b < lab.NB)
    if k.sum() < 60:
        return None
    arr = np.full((5, lab.NB), np.nan)
    for i, col in enumerate(("open", "high", "low", "close", "volume")):
        arr[i, b[k]] = df[col].to_numpy(dtype=float)[sel][k]
    for q in range(1, lab.NB):
        if np.isnan(arr[3, q]):
            arr[0:4, q] = arr[3, q - 1]
            arr[4, q] = 0.0
    return arr if np.isfinite(arr[3]).all() else None


# ------------------------------------------------------------ the decision
def _with_today(d: dict, day: int, opens: dict[str, float], bench_open: float) -> dict:
    """The daily panel with a row for `day` that knows only the opening prices (H/L/C/V unknown)."""
    p = d["p"]
    assert p.days[-1] < day, "the daily panel already has today"
    S = len(p.symbols)
    row = np.full((1, S), np.nan)
    o = row.copy()
    for j, s in enumerate(p.symbols):
        if s in opens:
            o[0, j] = opens[s]
    days = np.append(p.days, day)
    P = type(p)(days, p.symbols, np.vstack([p.O, o]), np.vstack([p.H, row]), np.vstack([p.L, row]),
                np.vstack([p.C, row]), np.vstack([p.V, row]), np.append(p.bench_o, bench_open), np.append(p.bench_c, np.nan),
                p.actions)
    member = pit.mask(days, p.symbols, pit.snapshots())
    deliv = np.vstack([d["deliv"], row])
    oi = {k: np.vstack([v, row]) for k, v in d["oi"].items()}
    return {**d, "p": P, "member": member, "deliv": deliv, "oi": oi}


def candidates(d: dict, day: int, n: int = CANDIDATES) -> list[str]:
    """Members on `day` with enough history, most liquid first by yesterday's 60-day median turnover."""
    p = d["p"]
    C, V = p.C, p.V
    liq = np.log(pd.DataFrame(C * V).rolling(60, min_periods=40).median().to_numpy()[-1])
    member = pit.mask(np.array([day]), p.symbols, pit.snapshots())
    mem = member[0] if member is not None else np.ones(len(p.symbols), dtype=bool)
    hist = np.isfinite(C).sum(axis=0) + d.get("hist0", 0)
    ok = mem & np.isfinite(liq) & (hist >= dtm.MIN_HISTORY) & np.isfinite(C[-1])
    order = np.argsort(-np.where(ok, liq, -np.inf), kind="stable")
    return [p.symbols[j] for j in order[:n] if ok[j]]


def features(d: dict, day: int, bars: dict[str, dict], bench_open: float, vhist: dict[str, float], models: dict,
             opens: dict[str, float] | None = None) -> pd.DataFrame:
    """Today's rows with every lab.F_STAGE2 column and the stage-2 score, computed like lab.build.
    The daily open is the first 5-minute bar's open: on the current day it IS the official open, on the same
    price scale as the stored daily history (checked: identical for every name on the latest stored day).
    `opens` overrides it for replays of past days, whose daily history has since been back-adjusted."""
    opens = opens or {s: b["o"] for s, b in bars.items()}
    dd = _with_today(d, day, opens, bench_open)
    des = dtm.design(dd)
    t = len(dd["p"].days) - 1
    X1, _ii, jj = dtm.matrix(des, np.array([t]))
    if not len(jj):
        return pd.DataFrame()
    s1_raw = models["stage1"].predict(X1)
    syms = [dd["p"].symbols[j] for j in jj]
    df = pd.DataFrame({"symbol": syms, "j": jj, "s1_raw": s1_raw})
    for k in dtm.RANKED:
        df[f"p_{k}"] = des["x"][f"p_{k}"][t, jj]
    for k in dtm.RAW:
        df[k] = des["x"][k][t, jj]
    for k in dtm.MARKET:
        df[k] = des["m"][k][t]
    fb = pd.DataFrame([bars[s] for s in syms], index=df.index)
    with np.errstate(divide="ignore", invalid="ignore"):
        df["first_ret"] = fb.c / fb.o - 1
        df["first_rng"] = (fb.h - fb.l) / fb.o / df["atr_pct_raw"]
        df["first_relvol"] = fb.v / df.symbol.map(vhist)
        df["gap920"] = (1 + df["gap_raw"]) * (1 + df["first_ret"]) - 1
    df["px_0920"] = fb.c.to_numpy()
    df = df[np.abs(df["gap_raw"]) < MAX_ABS_GAP].reset_index(drop=True)
    df["s1"] = df["s1_raw"].rank(pct=True)
    for k in ("first_ret", "first_rng", "first_relvol", "gap920"):
        df[f"r_{k}"] = df[k].rank(pct=True)
    df["score"] = models["stage2"].predict(df[lab.F_STAGE2].to_numpy(dtype=np.float32))
    return df


def picks(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    out = {}
    ok = df[np.isfinite(df.score)].sort_values("score", kind="stable")
    for name, b in BOOKS.items():
        out[name] = ok.head(b["k"]).assign(rank=np.arange(1, min(b["k"], len(ok)) + 1))
    return out


def ltp(symbols: list[str]) -> tuple[dict[str, float], float]:
    g = Groww()
    p = g.get("/v1/live-data/ltp", {"segment": "CASH", "exchange_symbols": ",".join(f"NSE_{s}" for s in symbols)})
    return {k.split("_", 1)[1]: float(v) for k, v in p.items() if v is not None}, time.time()


def last_session_day() -> int:
    """The latest completed session before today, from NIFTYBEES daily bars (Groww)."""
    g = Groww()
    now = int(time.time() * 1000)
    bars = g.candles(config.BENCHMARK, 1440, now - 10 * 86_400_000, now)
    days = sorted({int(ist_day(np.array([b.time]))[0]) for b in bars})
    days = [x for x in days if x < today_ist()]
    return days[-1] if days else -1


def decide(wait: bool = True) -> dict:
    """Score today at 09:20 and store the picks. Safe to rerun: an already decided day is left alone."""
    now = time.time()
    day = today_ist(now)
    date = day_to_date(day)
    con = _db()
    if con.execute("SELECT 1 FROM live_days WHERE day=? AND status IN ('decided','settled')", (day,)).fetchone():
        return {"day": date.isoformat(), "status": "already decided"}
    if date.weekday() >= 5:
        return {"day": date.isoformat(), "status": "weekend"}
    models = load_models(date.year)
    late = minute_ist(now) > 9 * 60 + 35  # a replay of today's 09:20 decision run after the fact (tests, recovery)
    d = dtm.load()
    if late and d["p"].days[-1] >= day:  # today's daily bar is already stored: decide from the bars before it
        p0 = d["p"]
        k = p0.days < day
        d = {**d, "p": type(p0)(p0.days[k], p0.symbols, p0.O[k], p0.H[k], p0.L[k], p0.C[k], p0.V[k], p0.bench_o[k],
                                p0.bench_c[k], p0.actions),
             "deliv": d["deliv"][k], "oi": {kk: v[k] for kk, v in d["oi"].items()}}
    last = int(d["p"].days[-1])
    want = last_session_day()
    if last != want:
        raise RuntimeError(f"daily bars end {day_to_date(last)} but the last session was {day_to_date(want)} — run live-prepare")
    syms = candidates(d, day)
    vhist = first_bar_volume_history(syms, day)
    log(f"decide {date}: {len(syms)} candidates, models {models['meta']['year']}; waiting for the 09:15 bar")
    # the 09:15 bar is complete at 09:20:00; poll until most names have it (holiday: nobody does by 09:35)
    while wait and not late and minute_ist() < 9 * 60 + 20 + 2 / 60:
        time.sleep(1)
    bars, ready_at = {}, None
    for _attempt in range(40):
        got = fetch_today(syms + [config.BENCHMARK], date)
        bars = {s: fb for s, df in got.items() if (fb := first_bar(df, day)) is not None}
        if len(bars) >= 0.8 * len(syms):
            ready_at = time.time()
            break
        if minute_ist() > 9 * 60 + 35 or not wait:
            break
        time.sleep(5)
    if ready_at is None:
        con.execute("INSERT OR REPLACE INTO live_days(day, status, info) VALUES(?,?,?)",
                    (day, "no_session", json.dumps({"bars": len(bars), "candidates": len(syms)})))
        con.commit()
        return {"day": date.isoformat(), "status": "no session (holiday?)", "bars": len(bars)}
    bench = bars.pop(config.BENCHMARK, None)
    df = features(d, day, bars, bench["o"] if bench else np.nan, vhist, models)
    if len(df) < MIN_ROWS:
        raise RuntimeError(f"only {len(df)} scorable rows")
    pk = picks(df)
    names = sorted({s for p in pk.values() for s in p.symbol})
    lt, lt_at = {}, None
    if not late:  # the live price is only meaningful at decision time
        try:
            lt, lt_at = ltp(names)
        except GrowwError as e:
            log(f"ltp failed: {e}")
    decided_at = time.time()
    with con:
        con.execute("DELETE FROM live_rows WHERE day=?", (day,))
        keep = lab.F_STAGE2 + ["px_0920", "first_rng", "first_relvol", "gap920"]
        con.executemany("INSERT INTO live_rows(day, symbol, score, features) VALUES(?,?,?,?)",
                        [(day, r["symbol"], float(r["score"]),
                          json.dumps({k: (float(r[k]) if np.isfinite(r[k]) else None) for k in keep}))
                         for _, r in df.iterrows()])
        con.execute("DELETE FROM live_picks WHERE day=?", (day,))
        for book, p in pk.items():
            con.executemany("INSERT INTO live_picks VALUES(?,?,?,?,?,?,?,?,?)",
                            [(day, book, int(r["rank"]), r.symbol, -1, float(r.score), float(r.px_0920), lt.get(r.symbol), lt_at)
                             for _, r in p.iterrows()])
        con.execute("INSERT OR REPLACE INTO live_days(day, status, model_year, decided_at, bars_ready_at, n_rows, info) VALUES(?,?,?,?,?,?,?)",
                    (day, "decided", models["meta"]["year"], decided_at, ready_at, len(df),
                     json.dumps({"candidates": len(syms), "bars": len(bars), "late": late})))
    out = {"day": date.isoformat(), "status": "decided" + (" (late replay)" if late else ""), "rows": len(df),
           "bars_ready": time.strftime("%H:%M:%S", time.gmtime(ready_at + config.IST_OFFSET_S)),
           "decided": time.strftime("%H:%M:%S", time.gmtime(decided_at + config.IST_OFFSET_S)),
           "picks": {b: [{"symbol": r.symbol, "score": round(float(r.score), 5), "px_0920": float(r.px_0920), "ltp": lt.get(r.symbol)}
                         for _, r in p.iterrows()] for b, p in pk.items()}}
    log(json.dumps(out))
    return out


# ------------------------------------------------------------ settlement
@njit(cache=True)
def _walk_live(o, h, l, c, side, e, entry_bar, exit_bar, stop, slip, mkt, mstop):
    """lab._walk for a stop-only position entered at price e (slippage included), plus the market stop:
    after the per-bar stop check, cover at the bar's close once the session's average stock has moved
    `mstop` against the position since the entry bar. Returns (exit px, exit bar, reason)."""
    if side > 0:
        sp = e * (1.0 - stop) if stop > 0 else -np.inf
    else:
        sp = e * (1.0 + stop) if stop > 0 else np.inf
    for i in range(entry_bar + 1, exit_bar + 1):
        if side > 0:
            if o[i] <= sp:
                return o[i] * (1.0 - slip), i, 1
            if l[i] <= sp:
                return sp * (1.0 - slip), i, 1
        else:
            if o[i] >= sp:
                return o[i] * (1.0 + slip), i, 1
            if h[i] >= sp:
                return sp * (1.0 + slip), i, 1
        if mstop > 0 and i < exit_bar and side * mkt[i] <= -mstop:
            return c[i] * (1.0 - slip * side), i, 5
    return c[exit_bar] * (1.0 - slip * side), exit_bar, 0


def price_book(book: dict, picks_: pd.DataFrame, P: dict[str, np.ndarray], mkt: np.ndarray, day: int,
               entry_px: dict[str, float] | None = None, slip_bps: float = lab.SLIP_BPS) -> pd.DataFrame:
    """Trades of one book on one day. P: symbol -> (5, NB) bars. entry_px: raw prices to enter at
    (default: the 09:20 bar close), slippage added here."""
    out = []
    slot = BOOK / book["k"]
    for _, r in picks_.iterrows():
        a = P.get(r.symbol)
        if a is None:
            continue
        side = int(r.side)
        raw = float(entry_px[r.symbol]) if entry_px and entry_px.get(r.symbol) else float(a[3, 0])
        slip = max(slip_bps / 1e4, 0.5 * float(lab.tick_size(np.array([a[3, 0]]), np.array([day]))[0]) / float(a[3, 0]))
        e = raw * (1.0 + slip * side)
        x, xb, why = _walk_live(a[0], a[1], a[2], a[3], side, e, 0, lab.NB - 1, book["stop"], slip, mkt, book["mstop"])
        q = math.floor(slot / e)
        if q <= 0:
            continue
        gross = (x - e) * q * side
        costs = float(trade_costs(np.array([q * e]), np.array([q * x]), np.array([side]), np.array([day]), True)[0])
        out.append({"symbol": r.symbol, "side": side, "qty": q, "entry": e, "exit": float(x), "exit_bar": int(xb), "why": int(why),
                    "gross": float(gross), "costs": costs, "net": float(gross - costs)})
    return pd.DataFrame(out)


def settle(day: int | None = None) -> dict:
    day = day if day is not None else today_ist()
    date = day_to_date(day)
    con = _db()
    st = con.execute("SELECT status FROM live_days WHERE day=?", (day,)).fetchone()
    if not st or st[0] not in ("decided", "settled"):
        return {"day": date.isoformat(), "status": f"nothing to settle ({st[0] if st else 'not decided'})"}
    if day == today_ist() and minute_ist() < 15 * 60 + 16:
        raise RuntimeError("settle after 15:16 IST (the 15:15 bar must be complete)")
    rows = [r[0] for r in con.execute("SELECT symbol FROM live_rows WHERE day=?", (day,))]
    got = fetch_today(rows, date)
    P = {s: a for s, df in got.items() if (a := paths(df, day)) is not None}
    if len(P) < MIN_ROWS:
        raise RuntimeError(f"only {len(P)} full sessions of bars")
    R = np.stack([P[s][3] / P[s][3, 0] - 1 for s in P])
    mkt = R.mean(axis=0)  # the session's average stock since the 09:20 close (the market stop's reference)
    pk = pd.read_sql_query("SELECT * FROM live_picks WHERE day=?", con, params=(day,))
    summary = {}
    with con:
        con.execute("DELETE FROM live_trades WHERE day=?", (day,))
        for name, book in BOOKS.items():
            p = pk[pk.book == name].sort_values("rank")
            for fill, px in (("bar", None), ("ltp", dict(zip(p.symbol, p.ltp)))):
                if fill == "ltp" and not p.ltp.notna().all():
                    continue
                T = price_book(book, p, P, mkt, day, px)
                con.executemany("INSERT INTO live_trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                                [(day, name, fill, r.symbol, r.side, r.qty, r.entry, r.exit, r.exit_bar, r.why, r.gross, r.costs, r.net)
                                 for r in T.itertuples(index=False)])
                summary[f"{name}/{fill}"] = {"net": round(float(T.net.sum()), 2) if len(T) else 0.0,
                                             "trades": [{"symbol": r.symbol, "entry": round(r.entry, 2), "exit_px": round(r.exit, 2),
                                                         "exit_reason": WHY.get(r.why, r.why), "net": round(r.net, 2)}
                                                        for r in T.itertuples(index=False)]}
        con.execute("UPDATE live_days SET status='settled', settled_at=? WHERE day=?", (time.time(), day))
    out = {"day": date.isoformat(), "status": "settled", "market_since_0920_at_1515": round(float(mkt[-1]), 5), "books": summary}
    log(json.dumps(out, default=str))
    return out


# ------------------------------------------------------------ preparation and reports
def prepare() -> dict:
    """Before the open: bars up to the last session, NSE files, and this year's models."""
    from . import nse

    t0 = time.time()
    out: dict = {}
    out["ingest"] = ingest.ingest(intervals=(1440, 5), respect_hours=False)
    try:
        out["nse"] = nse.update()
    except Exception as e:  # information features only: a missing day becomes NaN, as in history
        out["nse"] = {"error": str(e)[:300]}
    Y = day_to_date(today_ist()).year
    if not model_path(Y).exists():
        lab.build()
        out["train"] = train(Y)
    out["seconds"] = round(time.time() - t0)
    log(json.dumps(out, default=str))
    return out


def report() -> dict:
    con = _db()
    T = pd.read_sql_query("SELECT * FROM live_trades", con)
    days = pd.read_sql_query("SELECT day, status, decided_at, bars_ready_at FROM live_days ORDER BY day", con)
    out: dict = {"sessions": {k: int(v) for k, v in days.status.value_counts().items()}, "books": {}}
    if len(days):
        lag = (days.decided_at - (days.day * 86_400 - config.IST_OFFSET_S + (9 * 60 + 20) * 60)).dropna()
        out["decision_seconds_after_0920"] = {"median": round(float(lag.median()), 1), "max": round(float(lag.max()), 1)} if len(lag) else None
    for (book, fill), g in T.groupby(["book", "fill"]):
        daily = g.groupby("day").net.sum()
        months = g.groupby(pd.to_datetime(g.day, unit="D").dt.to_period("M")).net.sum()
        eq = daily.cumsum()
        out["books"][f"{book}/{fill}"] = {
            "days": int(len(daily)), "net_rs": round(float(daily.sum())), "pct_of_book": round(float(daily.sum() / BOOK), 4),
            "per_month_pct": {str(k): round(float(v / BOOK), 4) for k, v in months.items()},
            "day_win_rate": round(float((daily > 0).mean()), 3), "worst_day_rs": round(float(daily.min())),
            "best_day_rs": round(float(daily.max())), "max_drawdown_rs": round(float((eq.cummax().clip(lower=0) - eq).max())),
        }
    return out


# ------------------------------------------------------------ parity with the backtest
def parity(day: int, models: dict | None = None) -> dict:
    """Replay the 09:20 decision of a PAST session through this module, from stored data only (bars before that
    day, plus that day's first 5-minute bar), and compare with the lab panel and the lab baseline's score."""
    date = day_to_date(day)
    models = models or load_models(date.year)
    d = dtm.load()
    keep = d["p"].days < day
    p = d["p"]
    d = {**d, "p": type(p)(p.days[keep], p.symbols, p.O[keep], p.H[keep], p.L[keep], p.C[keep], p.V[keep], p.bench_o[keep],
                           p.bench_c[keep], p.actions),
         "deliv": d["deliv"][keep], "oi": {k: v[keep] for k, v in d["oi"].items()}}
    syms = candidates(d, day)
    bars = {}
    for s in syms + [config.BENCHMARK]:
        x = load_frame(s, 5)
        if x is not None and len(x) and (fb := first_bar(x, day)) is not None:
            bars[s] = fb
    bars.pop(config.BENCHMARK, None)
    full = dtm.load()["p"]
    t = int(np.searchsorted(full.days, day))
    assert full.days[t] == day, "no daily bars for that day"
    opens = {s: float(full.O[t, j]) for j, s in enumerate(full.symbols) if s in bars and np.isfinite(full.O[t, j])}
    df = features(d, day, bars, float(full.bench_o[t]), first_bar_volume_history(syms, day), models, opens=opens)
    L = lab.load(final=True)
    m = L.df.day.to_numpy() == day
    ref = L.df[m].copy()
    ref["score"] = models["stage2"].predict(lab.matrix(L, lab.F_STAGE2)[m])
    j = df.merge(ref, on="symbol", suffixes=("_live", "_lab"))
    cols = ["s1_raw", "first_ret", "gap_raw", "p_gap", "p_r5", "m_gap", "b_gap", "s1", "r_first_rng", "r_first_relvol", "r_gap920", "score"]
    diff = {c: float(np.nanmax(np.abs(j[f"{c}_live"] - j[f"{c}_lab"]))) for c in cols if f"{c}_live" in j}
    top_live = list(df.sort_values("score").symbol.head(3))
    top_lab = list(ref.sort_values("score").symbol.head(3))
    return {"day": date.isoformat(), "rows_live": int(len(df)), "rows_lab": int(len(ref)), "matched": int(len(j)),
            "max_abs_diff": {k: round(v, 6) for k, v in diff.items()}, "bottom3_live": top_live, "bottom3_lab": top_lab,
            "same_pick": top_live[:1] == top_lab[:1], "same_bottom3": set(top_live) == set(top_lab)}
