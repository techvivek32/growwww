"""Live PAPER trading of the strategy chosen for 2026 by the 1-lakh search (no auction, no overnight):

  09:20  score every liquid F&O stock with the ENS3 score: the session z-score average of three walk-forward
         gradient-boosting models (features F_STAGE2 / F_STAGE2+F_EXTRA / F_STAGE2+first-bar volume), and
         short the 1 lowest with the whole Rs 5L — unless the session is a REGIME SKIP day (at least 2 of:
         NIFTY gap in the top 20% of earlier sessions, first-bar breadth in the top 20%, Monday).
  bar i  MARKET STOP: cover at the bar's close once the average stock is up 0.5% since the 09:20 close.
  10:15  FLIP: if the median stock is up more than 0.25% since the open, cover the short at the 10:15 close
         and buy the day's top gainer (price >= Rs 50) with Rs 5L, held to 15:15.
  15:15  square off.

NO ORDER IS EVER SENT FROM HERE. This module reads Groww market data and writes its own tables (prefix livex_).
The website's live-trading executor reads the day's decisions (`today_state`, served at /live/today) and places
the real orders itself, in the accounts its admin has made eligible.
It reuses live.py's data plumbing and reproduces exp/search's engine for this variant (checked by `parity`).
"""

from __future__ import annotations

import datetime as dt
import json
import math
import sqlite3
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from . import config, daytrade as dtm, db, lab, live
from .costs import trade_costs
from .series import load_frame
from .sessions import ist_day, ist_minute
from .validation import day_to_date

BOOK = 500_000.0
SEED = config.SEED
MSTOP = 0.005
FLIP_BAR = 11  # closes 10:15
FLIP_THR = 0.0025
FLIP_MIN_PX = 50.0
EXIT_BAR = lab.NB - 1
MSTOP_LAST_BAR = EXIT_BAR - 1  # 70, the 15:10 close: the last bar the market stop is checked at (15:15 is the square-off)
MSTOP_WINDOW_S = (3.0, 60.0)  # a bar's close is checked live between 3 and 60 seconds after it
B_VOL = ["fb_v_daily", "fb_dv_rank", "fb_dv_vs_liq", "r_fb_v_daily"]
F_EXT = lab.F_STAGE2 + lab.F_EXTRA
F_FBV = lab.F_STAGE2 + B_VOL
SCHEMA = """
CREATE TABLE IF NOT EXISTS livex_days (
  day INTEGER PRIMARY KEY, status TEXT NOT NULL, model_year INTEGER, decided_at REAL, flip_at REAL, settled_at REAL,
  skip INTEGER, flags TEXT, n_rows INTEGER, pick TEXT, pick_px REAL, pick_ltp REAL, flip INTEGER, flip_symbol TEXT, flip_px REAL,
  info TEXT
);
CREATE TABLE IF NOT EXISTS livex_rows (day INTEGER NOT NULL, symbol TEXT NOT NULL, score REAL, z_base REAL, z_ext REAL, z_fbv REAL,
  px_0920 REAL, PRIMARY KEY (day, symbol));
CREATE TABLE IF NOT EXISTS livex_marks (day INTEGER NOT NULL, at REAL NOT NULL, minute INTEGER NOT NULL, phase TEXT NOT NULL,
  pick TEXT, pick_entry REAL, pick_ltp REAL, pick_qty REAL, pick_pnl REAL, mkt_move REAL, flip_symbol TEXT, flip_entry REAL, flip_ltp REAL,
  flip_qty REAL, flip_pnl REAL, running_net REAL, n_quotes INTEGER, PRIMARY KEY (day, minute));
CREATE TABLE IF NOT EXISTS livex_trades (day INTEGER NOT NULL, leg TEXT NOT NULL, symbol TEXT NOT NULL, side INTEGER NOT NULL,
  qty REAL NOT NULL, entry REAL NOT NULL, exit REAL NOT NULL, entry_bar INTEGER NOT NULL, exit_bar INTEGER NOT NULL, why INTEGER NOT NULL,
  gross REAL NOT NULL, costs REAL NOT NULL, net REAL NOT NULL, PRIMARY KEY (day, leg, symbol));
CREATE TABLE IF NOT EXISTS livex_events (day INTEGER NOT NULL, kind TEXT NOT NULL, at REAL NOT NULL, bar INTEGER, value REAL, info TEXT,
  PRIMARY KEY (day, kind));
"""
WHY = {0: "time", 5: "market stop", 6: "flip cover", 7: "admin"}
log = live.log


def _db():
    con = live._db()
    con.executescript(SCHEMA)
    if "legs" not in {c[1] for c in con.execute("PRAGMA table_info(livex_marks)")}:
        try:  # each mark's legs (JSON): what the live card shows, realised and open
            con.execute("ALTER TABLE livex_marks ADD COLUMN legs TEXT")
            con.commit()
        except sqlite3.OperationalError:
            pass  # another process added it first
    return con


# ------------------------------------------------------------ models
def model_path(year: int):
    return config.MODELS / f"livex_{year}.joblib"


def _fit(X, y, ok):
    return HistGradientBoostingRegressor(**dtm.HGB2, early_stopping=False, random_state=SEED).fit(X[ok], y[ok])


def fbv_features(L: lab.Lab) -> pd.DataFrame:
    """The features agent's first-bar volume columns, exactly as exp/features/strategy.first_bar_features."""
    df = L.df
    sym = df.symbol.to_numpy()
    v0, c0 = L.v[:, 0].astype(np.float64), L.c[:, 0].astype(np.float64)
    vs = L.v.sum(1).astype(np.float64)
    vs_prev = pd.Series(vs).groupby(sym).transform(lambda x: x.shift(1).rolling(20, min_periods=5).mean()).to_numpy()
    out = pd.DataFrame(index=df.index)
    with np.errstate(divide="ignore", invalid="ignore"):
        out["fb_v_daily"] = v0 / vs_prev
    out["fb_dv_rank"] = pd.Series(v0 * c0).groupby(df.day.to_numpy()).rank(pct=True).to_numpy()
    out["fb_dv_vs_liq"] = out["fb_dv_rank"] - df.p_liq.to_numpy()
    out["r_fb_v_daily"] = out.groupby(df.day.to_numpy())["fb_v_daily"].rank(pct=True)
    return out.replace([np.inf, -np.inf], np.nan).astype(np.float32)


def train(year: int | None = None, if_missing: bool = False) -> dict:
    """Freeze the three ENS3 models for `year`, each fitted on every panel session before 1 January `year`.
    `if_missing`: keep a year already frozen (the forward test must not change models mid-year)."""
    Y = year or day_to_date(live.today_ist()).year
    if if_missing and model_path(Y).exists():
        return {"year": Y, "status": "already frozen", "path": str(model_path(Y))}
    t0 = time.time()
    L = lab.load(final=True)
    y = lab.demean(L, lab.ret(L, 0, lab.NB - 1))
    ok = (L.year < Y) & np.isfinite(y)
    fb = fbv_features(L)
    models = {"base": _fit(lab.matrix(L, lab.F_STAGE2), y, ok), "ext": _fit(lab.matrix(L, F_EXT), y, ok),
              "fbv": _fit(np.column_stack([lab.matrix(L, lab.F_STAGE2), fb[B_VOL].to_numpy(dtype=np.float32)]), y, ok)}
    # regime thresholds: the 80th percentile of n_gap and m_first_up over sessions before the year (expanding, >= 60)
    sess = L.df.groupby("day").agg(n_gap=("n_gap", "first"), up=("m_first_up", "first")).sort_index()
    base_models = live.load_models(Y)  # stage 1 (daytrade) model, same as live.py
    meta = {"year": Y, "trained_at": time.time(), "rows": int(ok.sum()), "panel_last_day": day_to_date(int(L.df.day.max())).isoformat()}
    joblib.dump({"models": models, "stage1": base_models["stage1"], "sessions": sess, "meta": meta}, model_path(Y))
    log(f"livex models for {Y}: {ok.sum()} rows ({time.time() - t0:.0f}s)")
    return meta


def load_models(year: int) -> dict:
    p = model_path(year)
    if not p.exists():
        raise FileNotFoundError(f"no livex models for {year} — run `python -m mnha_research livex-train`")
    return joblib.load(p)


# ------------------------------------------------------------ features known at 09:20
def habits(symbols: list[str], before_day: int) -> pd.DataFrame:
    """The stock's intraday habits from its sessions before `before_day` (lab.build's prev-session features), plus the
    last-20-session mean of first-bar volume and of whole-day volume."""
    rows = []
    for s in symbols:
        x = load_frame(s, 5)
        if x is None or x.empty:
            continue
        t = x["time"].to_numpy(dtype=np.int64)
        d, m = ist_day(t), ist_minute(t)
        keep = d < before_day
        x, d, m = x[keep], d[keep], m[keep]
        if not len(x):
            continue
        b = (m - config.SESSION_OPEN) // 5
        h, l, c, v = (x[k].to_numpy(dtype=np.float64) for k in ("high", "low", "close", "volume"))
        o = x["open"].to_numpy(dtype=np.float64)
        days_u, start = np.unique(d, return_index=True)
        ends = np.append(start[1:], len(d))
        rec = []
        for dd, s0, s1 in zip(days_u[-60:], start[-60:], ends[-60:]):
            bb = b[s0:s1]
            if bb[0] != 0:
                continue
            cc, vv = c[s0:s1], v[s0:s1]
            tp = (h[s0:s1] + l[s0:s1] + cc) / 3
            def at(k):
                mm = np.nonzero(bb <= k)[0]
                return cc[mm[-1]] if len(mm) else np.nan
            vw = float((tp * vv).sum() / vv.sum()) if vv.sum() > 0 else np.nan
            rec.append((int(dd), o[s0], cc[0], at(lab.bar_of("10:15")), at(lab.bar_of("14:25")), at(lab.NB - 1), cc[-1], vw, vv[0], vv.sum()))
        if len(rec) < 3:
            continue
        sm = pd.DataFrame(rec, columns=["day", "o915", "c920", "c1015", "c1425", "c1515", "c_last", "vwap", "v_first", "v_day"]).set_index("day").sort_index()
        gap = sm.o915 / sm.c_last.shift(1) - 1
        oc = sm.c1515 / sm.c920 - 1
        f = {"symbol": s,
             "im5": oc.rolling(5, min_periods=3).mean().iloc[-1], "im20": oc.rolling(20, min_periods=10).mean().iloc[-1],
             "rev20": (-np.sign(gap) * oc).rolling(20, min_periods=10).mean().iloc[-1],
             "on5": gap.rolling(5, min_periods=3).mean().iloc[-1], "on20": gap.rolling(20, min_periods=10).mean().iloc[-1],
             "pd_last_hour": sm.c_last.iloc[-1] / sm.c1425.iloc[-1] - 1, "pd_vwap": sm.c_last.iloc[-1] / sm.vwap.iloc[-1] - 1,
             "pd_first_hour": sm.c1015.iloc[-1] / sm.o915.iloc[-1] - 1,
             "v_first_mean20": sm.v_first.rolling(20, min_periods=10).mean().iloc[-1],
             "v_day_mean20": sm.v_day.rolling(20, min_periods=5).mean().iloc[-1]}
        rows.append(f)
    return pd.DataFrame(rows).set_index("symbol")


def nifty_first(day: int, bars_nifty: dict | None) -> tuple[float, float]:
    """(n_first, n_gap) from NIFTY's first 5-minute bar and its previous session's last close."""
    if bars_nifty is None:
        return np.nan, np.nan
    x = load_frame("NIFTY", 5)
    d = ist_day(x["time"].to_numpy(dtype=np.int64))
    prev = x["close"].to_numpy()[d < day]
    n_gap = bars_nifty["o"] / prev[-1] - 1 if len(prev) else np.nan
    return bars_nifty["c"] / bars_nifty["o"] - 1, n_gap


def expiry_days(day: int) -> float:
    """Trading days until the month's stock-derivative expiry (last Tuesday from 2025-09, last Thursday before), counted
    as weekdays after `day`, as lab._expiry_days counts sessions (holidays make this one day too high; NaN after expiry)."""
    x = day_to_date(day)
    wd = 1 if x >= dt.date(2025, 9, 1) else 3
    last = dt.date(x.year + (x.month == 12), x.month % 12 + 1, 1) - dt.timedelta(days=1)
    while last.weekday() != wd:
        last -= dt.timedelta(days=1)
    if x > last:
        return np.nan
    return float(np.busday_count(x, last))  # weekdays in (x, last]


def panel_volume_baseline(day: int) -> dict[str, float]:
    """Per symbol, the mean whole-session volume (bars 09:15..15:10) of its last 20 panel rows before `day`
    (the features agent's fb_v_daily denominator). The panel must be built up to the previous session."""
    L = lab.load(final=True)
    keep = L.df.day.to_numpy() < day
    vs = pd.Series(L.v[keep].sum(1).astype(np.float64), index=L.df.symbol.to_numpy()[keep])
    return vs.groupby(level=0).apply(lambda x: x.iloc[-20:].mean() if len(x) >= 5 else np.nan).to_dict()


def full_features(d: dict, day: int, bars: dict[str, dict], bench_open: float, hab: pd.DataFrame, nf: tuple[float, float],
                  models: dict, opens: dict | None = None, panel_vs: dict | None = None) -> pd.DataFrame:
    """live.features (F_STAGE2 columns) plus F_EXTRA and B_VOL, then the three model scores and ENS3."""
    panel_vs = panel_vs if panel_vs is not None else panel_volume_baseline(day)
    vhist = hab["v_first_mean20"].to_dict()
    df = live.features(d, day, bars, bench_open, vhist, {"stage1": models["stage1"], "stage2": models["models"]["base"]}, opens=opens)
    if df.empty:
        return df
    fb = pd.DataFrame([bars[s] for s in df.symbol], index=df.index)
    dayn = np.array([day])
    with np.errstate(divide="ignore", invalid="ignore"):
        rng = fb.h - fb.l
        df["first_loc"] = np.where(rng > 0, (fb.c - fb.l) / rng, 0.5)
        for k in ("im5", "im20", "rev20", "on5", "on20", "pd_last_hour", "pd_vwap", "pd_first_hour"):
            df[k] = df.symbol.map(hab[k]).astype(float)
        df["n_first"], df["n_gap"] = nf
        df["m_first_med"] = df.first_ret.median()
        df["m_first_up"] = (df.first_ret > 0).mean()
        df["m_first_disp"] = df.first_ret.std()
        df["to_expiry"] = expiry_days(day)
        df["dom"] = day_to_date(day).day
        for k in ("im5", "im20", "rev20", "on5", "on20", "pd_last_hour", "pd_vwap", "pd_first_hour", "first_loc"):
            df[f"r_{k}"] = df[k].rank(pct=True)
        df["fb_v_daily"] = fb.v.to_numpy() / df.symbol.map(panel_vs).to_numpy()
        df["fb_dv_rank"] = (fb.v * fb.c).rank(pct=True)
        df["fb_dv_vs_liq"] = df["fb_dv_rank"] - df["p_liq"]
        df["r_fb_v_daily"] = df["fb_v_daily"].rank(pct=True)
    M = models["models"]
    z = {}
    for name, cols in (("base", lab.F_STAGE2), ("ext", F_EXT), ("fbv", F_FBV)):
        s = M[name].predict(df[cols].to_numpy(dtype=np.float32))
        z[name] = (s - s.mean()) / s.std()
        df[f"z_{name}"] = z[name]
    df["score"] = np.mean([z["base"], z["ext"], z["fbv"]], axis=0)
    return df


def regime_flags(models: dict, day: int, n_gap: float, m_first_up: float) -> dict:
    sess = models["sessions"]
    hist = sess[sess.index < day]
    out = {"n_gap_top20": False, "breadth_top20": False, "monday": day_to_date(day).weekday() == 0}
    if len(hist) >= 60:
        out["n_gap_top20"] = bool(np.isfinite(n_gap) and n_gap > hist.n_gap.quantile(0.8))
        out["breadth_top20"] = bool(m_first_up > hist.up.quantile(0.8))
    out["skip"] = sum(bool(v) for k, v in out.items() if k != "skip") >= 2
    return out


# ------------------------------------------------------------ 09:20
def prepare_ctx(day: int | None = None) -> dict:
    """Everything the 09:20 decision needs that is known BEFORE the open: models, the daily panel up to the previous
    session, the candidate list, the stocks' intraday habits and the volume baseline. The session loop computes it
    at 09:12 so the 09:20 decision itself takes seconds."""
    day = day if day is not None else live.today_ist()
    date = day_to_date(day)
    models = load_models(date.year)
    d = dtm.load()
    if d["p"].days[-1] >= day:  # today's (partial) daily bar is already stored: decide from the bars before it
        p0 = d["p"]
        k = p0.days < day
        d = {**d, "p": type(p0)(p0.days[k], p0.symbols, p0.O[k], p0.H[k], p0.L[k], p0.C[k], p0.V[k], p0.bench_o[k], p0.bench_c[k], p0.actions),
             "deliv": d["deliv"][k], "oi": {kk: v[k] for kk, v in d["oi"].items()}}
    last = int(d["p"].days[-1])
    want = live.last_session_day()
    if last != want:
        raise RuntimeError(f"daily bars end {day_to_date(last)} but the last session was {day_to_date(want)} — run live-prepare")
    syms = live.candidates(d, day)
    hab = habits(syms, day)
    panel_vs = panel_volume_baseline(day)
    log(f"livex context {date}: {len(syms)} candidates, habits for {len(hab)}, volume baseline for {len(panel_vs)}")
    return {"day": day, "models": models, "d": d, "syms": syms, "hab": hab, "panel_vs": panel_vs}


def decide(wait: bool = True, ctx: dict | None = None) -> dict:
    now = time.time()
    day = live.today_ist(now)
    date = day_to_date(day)
    con = _db()
    if con.execute("SELECT 1 FROM livex_days WHERE day=? AND status IN ('decided','flipped','settled')", (day,)).fetchone():
        return {"day": date.isoformat(), "status": "already decided"}
    if date.weekday() >= 5:
        return {"day": date.isoformat(), "status": "weekend"}
    late = live.minute_ist(now) > 9 * 60 + 35
    if ctx is None or ctx.get("day") != day:
        ctx = prepare_ctx(day)
    models, d, syms, hab = ctx["models"], ctx["d"], ctx["syms"], ctx["hab"]
    log(f"livex decide {date}: waiting for the 09:15 bar")
    while wait and not late and live.minute_ist() < 9 * 60 + 20 + 2 / 60:
        time.sleep(1)
    bars, ready_at = {}, None
    for _ in range(40):
        got = live.fetch_today(syms + [config.BENCHMARK, "NIFTY"], date)
        bars = {s: fb for s, df_ in got.items() if (fb := live.first_bar(df_, day)) is not None}
        if len(bars) >= 0.8 * len(syms):
            ready_at = time.time()
            break
        if live.minute_ist() > 9 * 60 + 35 or not wait:
            break
        time.sleep(5)
    if ready_at is None:
        if not wait and live.minute_ist() <= 9 * 60 + 35:
            # The session loop calls again shortly: a slow feed at 09:20 must not write the whole
            # day off while there is still time to decide (a holiday is recognised at 09:35).
            return {"day": date.isoformat(), "status": "waiting for bars", "bars": len(bars)}
        with con:
            if not con.in_transaction:
                con.execute("BEGIN IMMEDIATE")  # the check and the write under one lock
            if con.execute("SELECT 1 FROM livex_days WHERE day=? AND status IN ('decided','flipped','settled')", (day,)).fetchone():
                return {"day": date.isoformat(), "status": "already decided"}
            con.execute("INSERT OR REPLACE INTO livex_days(day, status, info) VALUES(?,?,?)", (day, "no_session", json.dumps({"bars": len(bars)})))
        return {"day": date.isoformat(), "status": "no session (holiday?)"}
    bench = bars.pop(config.BENCHMARK, None)
    nf = nifty_first(day, bars.pop("NIFTY", None))
    df = full_features(d, day, bars, bench["o"] if bench else np.nan, hab, nf, models, panel_vs=ctx["panel_vs"])
    if len(df) < live.MIN_ROWS:
        raise RuntimeError(f"only {len(df)} scorable rows")
    flags = regime_flags(models, day, nf[1], float(df.m_first_up.iloc[0]))
    pick = df.sort_values("score", kind="stable").iloc[0]
    lt, lt_at = {}, None
    if not late:
        try:
            lt, lt_at = live.ltp([pick.symbol])
        except Exception as e:  # noqa: BLE001
            log(f"ltp failed: {e}")
    with con:
        # The first decision of the day stands: never overwrite one another run made meanwhile.
        if not con.in_transaction:
            con.execute("BEGIN IMMEDIATE")  # the check and the writes under one lock
        if con.execute("SELECT 1 FROM livex_days WHERE day=? AND status IN ('decided','flipped','settled')", (day,)).fetchone():
            return {"day": date.isoformat(), "status": "already decided"}
        con.execute("DELETE FROM livex_rows WHERE day=?", (day,))
        con.executemany("INSERT INTO livex_rows VALUES(?,?,?,?,?,?,?)",
                        [(day, r.symbol, float(r.score), float(r.z_base), float(r.z_ext), float(r.z_fbv), float(r.px_0920)) for r in df.itertuples()])
        con.execute("INSERT OR REPLACE INTO livex_days(day, status, model_year, decided_at, skip, flags, n_rows, pick, pick_px, pick_ltp, info) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (day, "decided", models["meta"]["year"], time.time(), int(flags["skip"]), json.dumps(flags), len(df), pick.symbol,
                     float(pick.px_0920), lt.get(pick.symbol), json.dumps({"bars": len(bars), "late": late, "ltp_at": lt_at})))
    out = {"day": date.isoformat(), "status": "decided" + (" (late replay)" if late else ""), "rows": len(df), "regime": flags,
           "action": "SKIP today (regime)" if flags["skip"] else f"SHORT {pick.symbol} @ {pick.px_0920:.2f} (full book), market stop 0.5%, flip check 10:15",
           "pick": {"symbol": pick.symbol, "score": round(float(pick.score), 4), "px_0920": float(pick.px_0920), "ltp": lt.get(pick.symbol)},
           "bottom5": [{"symbol": r.symbol, "score": round(float(r.score), 4)} for r in df.sort_values("score").head(5).itertuples()]}
    log(json.dumps(out))
    return out


# ------------------------------------------------------------ 10:15 and settlement
def _paths_today(day: int, symbols: list[str]) -> dict[str, np.ndarray]:
    got = live.fetch_today(symbols, day_to_date(day))
    P = {s: a for s, df_ in got.items() if (a := live.paths(df_, day)) is not None}
    if len(P) < max(1, len(symbols) // 2):  # the backtesting endpoint lags on recent past days: use the range endpoint
        got = live.fetch_range_day(symbols, day)
        P = {s: a for s, df_ in got.items() if (a := live.paths(df_, day)) is not None}
    return P


def _partial_paths(day: int, symbols: list[str], upto_bar: int) -> dict[str, np.ndarray]:
    """Bars 0..upto_bar of today (no completeness requirement beyond those bars)."""
    got = live.fetch_today(symbols, day_to_date(day))
    out = {}
    for s, df_ in got.items():
        t = df_["time"].to_numpy(dtype=np.int64)
        sel = ist_day(t) == day
        b = (ist_minute(t[sel]) - config.SESSION_OPEN) // 5
        if not ((b >= 0) & (b <= upto_bar)).sum() >= upto_bar - 1:
            continue
        if not (b == upto_bar).any():
            continue  # the decision bar itself has not arrived: never decide on a carried-forward close
        arr = np.full((5, upto_bar + 1), np.nan)
        k = (b >= 0) & (b <= upto_bar)
        for i, col in enumerate(("open", "high", "low", "close", "volume")):
            arr[i, b[k]] = df_[col].to_numpy(dtype=float)[sel][k]
        for q in range(1, upto_bar + 1):
            if np.isnan(arr[3, q]):
                arr[0:4, q] = arr[3, q - 1]
                arr[4, q] = 0.0
        if np.isfinite(arr[3]).all():
            out[s] = arr
    return out


def flip_decision(P: dict[str, np.ndarray]) -> tuple[bool, str | None, float]:
    """(flip?, top gainer, median move since the open) at the close of FLIP_BAR, over the session's rows."""
    since = {s: a[3, FLIP_BAR] / a[0, 0] - 1 for s, a in P.items()}
    med = float(np.median(list(since.values())))
    if med <= FLIP_THR:
        return False, None, med
    cand = {s: v for s, v in since.items() if P[s][3, 0] >= FLIP_MIN_PX}
    top = max(cand, key=cand.get) if cand else None
    return True, top, med


def flip() -> dict:
    """At 10:16: record the flip decision from bars 0..11 (the strategy's second decision time)."""
    day = live.today_ist()
    con = _db()
    r = con.execute("SELECT status, skip, pick FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] != "decided":
        return {"status": f"nothing to do ({r[0] if r else 'not decided'})"}
    rows = [x[0] for x in con.execute("SELECT symbol FROM livex_rows WHERE day=?", (day,))]
    while live.minute_ist() < 10 * 60 + 15 + 0.5:
        time.sleep(2)
    P = _partial_paths(day, rows, FLIP_BAR)
    if len(P) < max(live.MIN_ROWS, 0.8 * len(rows)):
        # Record nothing on thin data: the session retries a flip() that raises.
        raise RuntimeError(f"only {len(P)} of {len(rows)} names have the 10:10-10:15 bar")
    do, top, med = flip_decision(P)
    px = float(P[top][3, FLIP_BAR]) if do and top else None
    with con:
        # The first flip decision stands: another run never overwrites it.
        cur = con.execute("UPDATE livex_days SET status='flipped', flip_at=?, flip=?, flip_symbol=?, flip_px=? WHERE day=? AND status='decided'",
                          (time.time(), int(do), top, px, day))
        if cur.rowcount and do and not r[1] and r[2] in P:  # the short's cover price, for the live card
            con.execute("INSERT OR IGNORE INTO livex_events(day, kind, at, bar, value, info) VALUES(?,?,?,?,?,?)",
                        (day, "flip_cover", time.time(), FLIP_BAR, float(P[r[2]][3, FLIP_BAR]), json.dumps({"pick": r[2], "long": top})))
    if cur.rowcount == 0:
        rec = con.execute("SELECT flip FROM livex_days WHERE day=?", (day,)).fetchone()
        return {"day": day_to_date(day).isoformat(), "status": "already flipped", "flip": bool(rec and rec[0])}
    out = {"day": day_to_date(day).isoformat(), "median_since_open": round(med, 5), "flip": do,
           "action": (f"COVER the short, BUY {top} @ {px:.2f} (full book) till 15:15" if do and not r[1] else ("regime skip day" if r[1] else "no flip: hold the short"))}
    log(json.dumps(out))
    return out


def price_day(day: int, pick: str, skip: bool, P: dict[str, np.ndarray], flip_rec: tuple | None = None, slip_bps: float = lab.SLIP_BPS,
              admin: tuple | None = None) -> list[dict]:
    """The day's legs priced exactly like exp/search/engine.day_pnl for this variant. `admin` = (bar, price) when the
    admin reversed the short into a long of the same stock by hand (livex_events 'admin_reverse'): the short is covered
    at that price in that bar (unless the market stop got there first) and a long runs from there to 15:15."""
    out = []
    if skip or pick not in P:
        return out
    R = np.stack([P[s][3] / P[s][3, 0] - 1 for s in P])
    mkt = R.mean(axis=0)
    do, top, _med = flip_rec if flip_rec is not None else flip_decision(P)
    if admin is not None:
        do, top = True, pick
    xb = (admin[0] if admin is not None else FLIP_BAR) if do else EXIT_BAR
    a = P[pick]
    slip = max(slip_bps / 1e4, 0.5 * float(lab.tick_size(np.array([a[3, 0]]), np.array([day]))[0]) / float(a[3, 0]))
    e = a[3, 0] * (1 - slip)
    q = math.floor(BOOK / e)
    x, xbar, why = live._walk_live(a[0], a[1], a[2], a[3], -1, e, 0, xb, 0.0, slip, mkt, MSTOP)
    if xbar == xb and why == 0 and do:
        why = 6
    if admin is not None and xbar == xb and why == 6:
        x, why = admin[1] * (1 + slip), 7  # covered at the admin's price, not the bar close
    def leg(name, sym, side, q, e, x, eb, xbar, why):
        gross = (x - e) * q * side
        costs = float(trade_costs(np.array([q * e]), np.array([q * x]), np.array([side]), np.array([day]), True)[0])
        return {"leg": name, "symbol": sym, "side": side, "qty": q, "entry": float(e), "exit": float(x), "entry_bar": eb, "exit_bar": int(xbar),
                "why": int(why), "gross": float(gross), "costs": costs, "net": float(gross - costs)}
    out.append(leg("short", pick, -1, q, e, x, 0, xbar, why))
    if admin is not None:
        if why == 7 and (len(admin) < 3 or admin[2] == "reverse"):  # the long only exists on a reversal of a still-open short
            g = P[pick]
            s2 = max(slip_bps / 1e4, 0.5 * float(lab.tick_size(np.array([admin[1]]), np.array([day]))[0]) / admin[1])
            e2 = admin[1] * (1 + s2)
            q2 = math.floor(BOOK / e2)
            x2, xb2 = g[3, EXIT_BAR] * (1 - s2), EXIT_BAR
            if len(admin) > 3 and admin[3] is not None:  # the admin sold the long early: (bar, price)
                x2, xb2 = admin[3][1] * (1 - s2), admin[3][0]
            out.append(leg("admin_long", pick, 1, q2, e2, x2, admin[0], xb2, 7 if xb2 != EXIT_BAR else 0))
        return out
    if do and top and top in P:
        g = P[top]
        s2 = max(slip_bps / 1e4, 0.5 * float(lab.tick_size(np.array([g[3, FLIP_BAR]]), np.array([day]))[0]) / float(g[3, FLIP_BAR]))
        e2 = g[3, FLIP_BAR] * (1 + s2)
        q2 = math.floor(BOOK / e2)
        x2 = g[3, EXIT_BAR] * (1 - s2)
        out.append(leg("flip_long", top, 1, q2, e2, x2, FLIP_BAR, EXIT_BAR, 0))
    return out


# 25 Nov 2026: a 2% reversal rule was built at the admin's request and withdrawn the same day (the admin asked for Book A
# to run exactly as tested). The admin_reverse / admin_close_long records below stay so that day settles correctly.


def _reshort(con, day: int) -> tuple | None:
    """(bar, price) of the admin's re-short today, or None; closed by an 'admin_close_reshort' event."""
    ev = con.execute("SELECT bar, value FROM livex_events WHERE day=? AND kind='admin_reshort'", (day,)).fetchone()
    if not ev or con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='admin_close_reshort'", (day,)).fetchone():
        return None
    return int(ev[0]), float(ev[1])


def admin_reshort() -> dict:
    """The admin's order: after the short was covered by hand (reversal / cover), short the pick AGAIN now at the live
    price, to 15:15 with the market stop. Recorded as an event; settle() prices the leg from it."""
    now = time.time()
    day, minute = live.today_ist(now), live.minute_ist(now)
    con = _db()
    r = con.execute("SELECT status, skip, pick FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] != "flipped" or r[1] or not r[2]:
        raise RuntimeError("no covered Book A short to re-open today")
    if not con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='admin_reverse'", (day,)).fetchone():
        raise RuntimeError("the short was not covered by hand today")
    if con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='admin_reshort'", (day,)).fetchone():
        raise RuntimeError("already re-shorted today")
    pick = r[2]
    q = _ltp_many([pick])
    if pick not in q:
        raise RuntimeError(f"no live price for {pick}")
    px = q[pick]
    bar = int(min(max((minute - (9 * 60 + 20)) // 5 + 1, 1), EXIT_BAR - 1))
    with con:
        con.execute("INSERT OR REPLACE INTO livex_events VALUES(?,?,?,?,?,?)",
                    (day, "admin_reshort", now, bar, px, json.dumps({"symbol": pick, "time": f"{int(minute) // 60:02d}:{int(minute) % 60:02d}"})))
        con.execute("UPDATE livex_days SET info=COALESCE(info,'') || ? WHERE day=?", (f" | admin re-short at {px} (bar {bar})", day))
    out = {"day": day_to_date(day).isoformat(), "symbol": pick, "price": px, "bar": bar, "action": "short re-opened (paper, admin's order)"}
    log(json.dumps({"admin_reshort": out}))
    return out


def admin_close_reshort() -> dict:
    now = time.time()
    day, minute = live.today_ist(now), live.minute_ist(now)
    con = _db()
    rs = _reshort(con, day)
    if rs is None:
        raise RuntimeError("no open re-short today")
    pick = con.execute("SELECT pick FROM livex_days WHERE day=?", (day,)).fetchone()[0]
    q = _ltp_many([pick])
    if pick not in q:
        raise RuntimeError(f"no live price for {pick}")
    px = q[pick]
    bar = int(min(max((minute - (9 * 60 + 20)) // 5 + 1, 1), EXIT_BAR))
    with con:
        con.execute("INSERT OR REPLACE INTO livex_events VALUES(?,?,?,?,?,?)",
                    (day, "admin_close_reshort", now, bar, px, json.dumps({"symbol": pick, "time": f"{int(minute) // 60:02d}:{int(minute) % 60:02d}"})))
    out = {"day": day_to_date(day).isoformat(), "symbol": pick, "price": px, "bar": bar, "action": "re-short covered (paper, admin's order)"}
    log(json.dumps({"admin_close_reshort": out}))
    return out


def admin_close_long() -> dict:
    """The admin's order: sell the long that an admin/rule reversal opened, now, at the live price. Recorded as an event;
    settle() prices the leg's exit from it."""
    now = time.time()
    day, minute = live.today_ist(now), live.minute_ist(now)
    con = _db()
    r = con.execute("SELECT status, flip, flip_symbol FROM livex_days WHERE day=?", (day,)).fetchone()
    ev = con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='admin_reverse'", (day,)).fetchone()
    if not r or r[0] != "flipped" or not r[1] or not r[2] or not ev:
        raise RuntimeError("no open reversal long today")
    if con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='admin_close_long'", (day,)).fetchone():
        raise RuntimeError("the long is already closed")
    sym = r[2]
    q = _ltp_many([sym])
    if sym not in q:
        raise RuntimeError(f"no live price for {sym}")
    px = q[sym]
    bar = int(min(max((minute - (9 * 60 + 20)) // 5 + 1, 1), EXIT_BAR))
    with con:
        con.execute("INSERT OR REPLACE INTO livex_events VALUES(?,?,?,?,?,?)",
                    (day, "admin_close_long", now, bar, px, json.dumps({"symbol": sym, "time": f"{int(minute) // 60:02d}:{int(minute) % 60:02d}"})))
        con.execute("UPDATE livex_days SET flip_symbol=NULL, info=COALESCE(info,'') || ? WHERE day=?", (f" | admin closed the long at {px} (bar {bar})", day))
    out = {"day": day_to_date(day).isoformat(), "symbol": sym, "price": px, "bar": bar, "action": "reversal long sold (paper, admin's order)"}
    log(json.dumps({"admin_close_long": out}))
    return out


def admin_reverse(mode: str = "reverse", who: str = "admin") -> dict:
    """The admin's order, by hand: cover Book A's open short NOW at the live price and, with mode "reverse", go long
    the same stock to 15:15 (mode "cover": stay flat). Recorded as an event; settle() prices the day from it.
    Outside the tested rule; the journal says so."""
    mode = "cover" if str(mode).lower().startswith("c") else "reverse"
    now = time.time()
    day, minute = live.today_ist(now), live.minute_ist(now)
    con = _db()
    r = con.execute("SELECT status, skip, pick, pick_px, flip, flip_symbol FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] not in ("decided", "flipped") or r[1]:
        raise RuntimeError(f"no open Book A short today ({r[0] if r else 'not decided'})")
    if r[0] == "flipped" and r[4]:
        raise RuntimeError("the short is already covered (10:15 flip)")
    if con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='admin_reverse'", (day,)).fetchone():
        raise RuntimeError("already reversed today")
    pick = r[2]
    q = _ltp_many([pick])
    if pick not in q:
        raise RuntimeError(f"no live price for {pick}")
    px = q[pick]
    bar = int(min(max((minute - (9 * 60 + 20)) // 5 + 1, 1), EXIT_BAR - 1))  # the 5-minute bar now in progress
    with con:
        con.execute("INSERT OR REPLACE INTO livex_events VALUES(?,?,?,?,?,?)",
                    (day, "admin_reverse", now, bar, px, json.dumps({"symbol": pick, "mode": mode, "who": who, "time": f"{int(minute) // 60:02d}:{int(minute) % 60:02d}"})))
        # flip=1 marks the short closed for mark()/ticks(); flip_symbol stays empty on a plain cover (no long leg)
        con.execute("UPDATE livex_days SET status='flipped', flip=1, flip_symbol=?, flip_px=?, flip_at=?, info=COALESCE(info,'') || ? WHERE day=?",
                    (pick if mode == "reverse" else None, px, now, f" | {who} {mode} at {px} (bar {bar})", day))
    out = {"day": day_to_date(day).isoformat(), "symbol": pick, "price": px, "bar": bar, "mode": mode,
           "action": "short covered, long opened (paper, admin's order)" if mode == "reverse" else "short covered (paper, admin's order)"}
    out["who"] = who
    log(json.dumps({"admin_reverse": out}))
    return out


def settle(day: int | None = None) -> dict:
    day = day if day is not None else live.today_ist()
    con = _db()
    r = con.execute("SELECT status, skip, pick, flip, flip_symbol FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] not in ("decided", "flipped", "settled"):
        return {"status": f"nothing to settle ({r[0] if r else 'not decided'})"}
    if day == live.today_ist() and live.minute_ist() < 15 * 60 + 16:
        raise RuntimeError("settle after 15:16 IST")
    rows = [x[0] for x in con.execute("SELECT symbol FROM livex_rows WHERE day=?", (day,))]
    P = _paths_today(day, rows)
    if len(P) < live.MIN_ROWS:
        raise RuntimeError(f"only {len(P)} full sessions of bars")
    # The recorded 10:15 decision once flip() ran: also when re-settling a settled day, which
    # must reproduce the result rather than work the flip out again. When flip() never ran
    # (the session was down at 10:15) it is decided here from bars 0..FLIP_BAR, once, and
    # stored, so re-settles, replay_b and the reports all see the same decision.
    store_flip = None
    if r[3] is not None:
        flip_rec = (bool(r[3]), r[4], np.nan)
    else:
        do, top, _med = flip_decision(P)
        flip_rec = (do, top, np.nan)
        store_flip = (int(do), top, float(P[top][3, FLIP_BAR]) if do and top else None)
    ev = con.execute("SELECT bar, value, info FROM livex_events WHERE day=? AND kind='admin_reverse'", (day,)).fetchone()
    admin = None
    if ev:
        mode = (json.loads(ev[2] or "{}").get("mode") or "reverse") if ev[2] else "reverse"
        cl = con.execute("SELECT bar, value FROM livex_events WHERE day=? AND kind='admin_close_long'", (day,)).fetchone()
        admin = (int(ev[0]), float(ev[1]), mode, (int(cl[0]), float(cl[1])) if cl else None)
    legs = price_day(day, r[2], bool(r[1]), P, flip_rec, admin=admin)
    rs = con.execute("SELECT bar, value FROM livex_events WHERE day=? AND kind='admin_reshort'", (day,)).fetchone()
    if rs and r[2] in P:
        a = P[r[2]]
        b3, p3 = int(rs[0]), float(rs[1])
        s3 = max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([p3]), np.array([day]))[0]) / p3)
        e3 = p3 * (1 - s3)
        q3 = math.floor(BOOK / e3)
        R = np.stack([P[s_][3] / P[s_][3, 0] - 1 for s_ in P])
        mkt = R.mean(axis=0) - (R.mean(axis=0)[b3] if b3 < len(R.mean(axis=0)) else 0.0)
        x3, xb3, why3 = live._walk_live(a[0], a[1], a[2], a[3], -1, e3, b3, EXIT_BAR, 0.0, s3, mkt, MSTOP)
        cl = con.execute("SELECT bar, value FROM livex_events WHERE day=? AND kind='admin_close_reshort'", (day,)).fetchone()
        if cl and int(cl[0]) <= xb3:
            x3, xb3, why3 = float(cl[1]) * (1 + s3), int(cl[0]), 7
        gross3 = (x3 - e3) * q3 * -1
        costs3 = float(trade_costs(np.array([q3 * e3]), np.array([q3 * x3]), np.array([-1]), np.array([day]), True)[0])
        legs.append({"leg": "admin_short", "symbol": r[2], "side": -1, "qty": q3, "entry": float(e3), "exit": float(x3), "entry_bar": b3, "exit_bar": int(xb3),
                     "why": int(why3), "gross": float(gross3), "costs": costs3, "net": float(gross3 - costs3)})
    with con:
        if store_flip is not None:
            con.execute("UPDATE livex_days SET flip=?, flip_symbol=?, flip_px=? WHERE day=? AND flip IS NULL", (*store_flip, day))
        con.execute("DELETE FROM livex_trades WHERE day=?", (day,))
        con.executemany("INSERT INTO livex_trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        [(day, L_["leg"], L_["symbol"], L_["side"], L_["qty"], L_["entry"], L_["exit"], L_["entry_bar"], L_["exit_bar"], L_["why"],
                          L_["gross"], L_["costs"], L_["net"]) for L_ in legs])
        con.execute("UPDATE livex_days SET status='settled', settled_at=? WHERE day=?", (time.time(), day))
    net = sum(L_["net"] for L_ in legs)
    out = {"day": day_to_date(day).isoformat(), "skip": bool(r[1]), "net_rs": round(net, 2), "net_pct": round(net / BOOK * 100, 3),
           "legs": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in L_.items()} | {"exit_reason": WHY.get(L_["why"], L_["why"])} for L_ in legs]}
    log(json.dumps(out))
    return out


def _ltp_many(symbols: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for i in range(0, len(symbols), 40):
        try:
            q, _at = live.ltp(symbols[i:i + 40])
            out.update(q)
        except Exception as e:  # noqa: BLE001
            log(f"ltp chunk failed: {e}")
    return out


LEG_LABEL = {"short": "Short (09:20 pick)", "flip_long": "Flip long (10:15)", "admin_long": "Admin long", "admin_short": "Admin short"}


def _legs_today(con, day: int, r, minute: float | None = None) -> list[dict]:
    """Book A's legs so far today from the recorded decision and events (no bars): entry, qty, side, and, once closed,
    the exit price and by what. Shared by mark() and ticks(), so the live card and the live strip agree; the official
    figures still come from the bars at settle (which follows the same order of events)."""
    status, skip, pick, pick_px, flip_on, flip_sym, flip_px = r
    if skip or not pick or not pick_px or status not in ("decided", "flipped"):
        return []
    ev = {k: (at, bar, val, inf) for k, at, bar, val, inf in con.execute("SELECT kind, at, bar, value, info FROM livex_events WHERE day=?", (day,))}

    def info(kind: str) -> dict:
        try:
            return json.loads(ev[kind][3] or "{}") if kind in ev else {}
        except Exception:  # noqa: BLE001
            return {}

    def slip(px: float) -> float:
        return max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([px]), np.array([day]))[0]) / px)

    def leg(name, sym, side, px):
        sl = slip(px)
        e = px * (1 + sl * side)  # a short fills a touch below the quote, a long a touch above
        return {"leg": name, "label": LEG_LABEL[name], "symbol": sym, "side": side, "entry": e, "qty": math.floor(BOOK / e), "slip": sl,
                "exit": None, "closed": False, "how": None}

    def close(L, px, how):
        L.update(closed=True, how=how, exit=None if px is None else float(px) * (1 + L["slip"] * -L["side"]))

    legs = []
    short = leg("short", pick, -1, float(pick_px))
    admin = "admin_reverse" in ev
    covers = []  # (time, price or None, by what): the earliest one covered the short
    if "mstop" in ev:
        covers.append((ev["mstop"][0], info("mstop").get("pick_ltp"), "market stop"))
    if admin:
        covers.append((ev["admin_reverse"][0], ev["admin_reverse"][2], "admin"))
    if "flip_cover" in ev:
        covers.append((ev["flip_cover"][0], ev["flip_cover"][2], "10:15 flip"))
    elif status == "flipped" and flip_on and not admin:
        covers.append((float("inf"), None, "10:15 flip"))  # flipped before cover prices were recorded
    if covers:
        _at, px, how = min(covers, key=lambda c: c[0])
        close(short, px, how)
    legs.append(short)
    if admin:
        # as at settle: the admin's long exists only if the admin, not the market stop, covered the short
        if (info("admin_reverse").get("mode") or "reverse") == "reverse" and short["how"] == "admin":
            L = leg("admin_long", pick, 1, float(ev["admin_reverse"][2]))
            if "admin_close_long" in ev:
                close(L, ev["admin_close_long"][2], "admin")
            legs.append(L)
    elif flip_on and flip_sym and flip_px:
        legs.append(leg("flip_long", flip_sym, 1, float(flip_px)))
    if "admin_reshort" in ev:
        L = leg("admin_short", pick, -1, float(ev["admin_reshort"][2]))
        if "admin_close_reshort" in ev:
            close(L, ev["admin_close_reshort"][2], "admin")
        legs.append(L)
    return legs


def mark() -> dict:
    """Every 30 s during the session: Book A's legs today at Groww's live prices (LTP), realised ones at their cover
    price, the average stock's move since 09:20 (the market stop watches 0.5%). Informational: the day's official result
    is still `settle`, priced from the 5-minute bars."""
    now = time.time()
    day, minute = live.today_ist(now), int(live.minute_ist(now))
    if not (9 * 60 + 22 <= minute <= 15 * 60 + 20):
        return {"status": "outside 09:22-15:20 IST"}
    con = _db()
    r = con.execute("SELECT status, skip, pick, pick_px, flip, flip_symbol, flip_px FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] not in ("decided", "flipped"):
        return {"status": f"no open paper position ({r[0] if r else 'not decided'})"}
    status, skip, pick = r[0], r[1], r[2]
    rows = [x[0] for x in con.execute("SELECT symbol FROM livex_rows WHERE day=?", (day,))]
    px0 = dict(con.execute("SELECT symbol, px_0920 FROM livex_rows WHERE day=?", (day,)).fetchall())
    legs = _legs_today(con, day, tuple(r))
    q = _ltp_many(sorted(set(rows) | {L["symbol"] for L in legs}))
    moves = [q[s_] / px0[s_] - 1 for s_ in rows if s_ in q and px0.get(s_)]
    mkt = float(np.mean(moves)) if moves else np.nan
    squared = minute >= 15 * 60 + 15
    for L in legs:
        L["ltp"] = q.get(L["symbol"])
        if not L["closed"] and squared and L["ltp"] is not None:  # square-off: closed at the 15:15 price, settled from the bars
            L.update(closed=True, how="15:15 square-off", exit=L["ltp"] * (1 + L["slip"] * -L["side"]))
        px = L["exit"] if L["closed"] else L["ltp"]
        L["pnl"] = None if px is None else round(L["side"] * (px - L["entry"]) * L["qty"], 2)
    realised = sum(L["pnl"] or 0.0 for L in legs if L["closed"])
    unrealised = sum(L["pnl"] or 0.0 for L in legs if not L["closed"])
    running = realised + unrealised
    short_open = next((L for L in legs if L["side"] < 0 and not L["closed"]), None)  # the open short (09:20 pick or re-short)
    long_leg = next((L for L in legs if L["side"] > 0), None)
    out = {"day": day_to_date(day).isoformat(), "time": f"{minute // 60:02d}:{minute % 60:02d}", "phase": "skip" if skip else status,
           "mkt_move_since_0920": round(mkt, 5), "market_stop_at": MSTOP, "quotes": len(q), "realised": round(realised, 2),
           "open": round(unrealised, 2), "running_net_before_costs": round(running, 2),
           "legs": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in L.items() if k != "slip"} for L in legs]}
    with con:
        con.execute("INSERT OR REPLACE INTO livex_marks(day, at, minute, phase, pick, pick_entry, pick_ltp, pick_qty, pick_pnl, mkt_move, "
                    "flip_symbol, flip_entry, flip_ltp, flip_qty, flip_pnl, running_net, n_quotes, legs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (day, now, minute, out["phase"], pick,
                     short_open["entry"] if short_open else (legs[0]["entry"] if legs else None), q.get(pick) if pick else None,
                     short_open["qty"] if short_open else (legs[0]["qty"] if legs else None), short_open["pnl"] if short_open else None,
                     mkt if np.isfinite(mkt) else None, long_leg["symbol"] if long_leg else None, long_leg["entry"] if long_leg else None,
                     long_leg["ltp"] if long_leg else None, long_leg["qty"] if long_leg else None, long_leg["pnl"] if long_leg else None,
                     running, len(q), json.dumps(out["legs"])))
    log(json.dumps(out))
    return out


def ticks() -> dict:
    """Every open paper position (Book A legs, Book B legs, active and manual trades) at the live price: one LTP call,
    no writes. For the paper page's per-second strip; the official figures still come from the bars at settle."""
    now = time.time()
    day, minute = live.today_ist(now), live.minute_ist(now)
    con = _db()
    items: list[dict] = []
    r = con.execute("SELECT status, skip, pick, pick_px, flip, flip_symbol, flip_px FROM livex_days WHERE day=?", (day,)).fetchone()
    phase = r[0] if r else "not decided"
    if r and minute < 15 * 60 + 15:  # after the square-off nothing of Book A is open
        for L in _legs_today(con, day, tuple(r)):
            if not L["closed"]:
                items.append({"book": "Book A", "leg": L["label"], "side": L["side"], "symbol": L["symbol"], "entry": round(L["entry"], 2), "qty": L["qty"]})
    for leg_, sym, side, qty, entry in con.execute("SELECT leg, symbol, side, qty, entry FROM livex_fast WHERE day=? AND exit IS NULL", (day,)):
        items.append({"book": "Book B", "leg": leg_, "side": int(side), "symbol": sym, "entry": round(float(entry), 2), "qty": int(qty)})
    p = config.DATA / "manual_trades.json"
    if p.exists():
        from . import manual as _manual

        for m in _manual._load():
            if m.get("status") == "open":
                items.append({"book": "Active" if m.get("book") == "active" else "Manual", "leg": m["side"], "side": -1 if m["side"] == "short" else 1,
                              "symbol": m["symbol"], "entry": m["entry"], "qty": m["qty"]})
    syms = sorted({it["symbol"] for it in items} | {"NIFTY"})
    q = _ltp_many(syms)
    total = 0.0
    for it in items:
        lt = q.get(it["symbol"])
        it["ltp"] = lt
        it["running_pnl"] = None if lt is None else round(it["side"] * (lt - it["entry"]) * it["qty"], 2)
        total += it["running_pnl"] or 0.0
    return {"at": now, "day": day_to_date(day).isoformat(), "phase": phase, "nifty": q.get("NIFTY"), "items": items, "running_total": round(total, 2)}


def bar_hm(b) -> str | None:
    if b is None:
        return None
    m = 9 * 60 + 20 + 5 * int(b)
    return f"{m // 60:02d}:{m % 60:02d}"


def _hms(t) -> str | None:
    return None if t is None else time.strftime("%H:%M:%S", time.gmtime(float(t) + config.IST_OFFSET_S))


def day_log(day: int) -> dict:
    """Everything recorded for one session, in order, for the admin's day-by-day log page: the 09:20 decision, the
    regime flags, the 10:15 flip, the market-stop checks, the admin's hand, Book A's legs, Book B's legs, the active and
    manual paper trades, and the running marks. Nothing is recomputed here."""
    con = _db()
    d = con.execute("SELECT * FROM livex_days WHERE day=?", (day,)).fetchone()
    date = day_to_date(day).isoformat()
    out: dict = {"day": date, "weekday": day_to_date(day).strftime("%a"), "book_a": None, "events": [], "book_b": [], "trades": [], "marks": []}
    if d:
        d = dict(d)
        flags = {}
        try:
            flags = json.loads(d.get("flags") or "{}")
        except Exception:  # noqa: BLE001
            pass
        out["book_a"] = {"status": d["status"], "skip": bool(d.get("skip")), "flags": flags, "model_year": d.get("model_year"), "n_rows": d.get("n_rows"),
                         "decided_at": _hms(d.get("decided_at")), "pick": d.get("pick"), "pick_px": d.get("pick_px"), "flip": None if d.get("flip") is None else bool(d["flip"]),
                         "flip_symbol": d.get("flip_symbol"), "flip_px": d.get("flip_px"), "flip_at": _hms(d.get("flip_at")), "settled_at": _hms(d.get("settled_at")),
                         "info": d.get("info")}
        legs = [dict(x) for x in con.execute("SELECT * FROM livex_trades WHERE day=? ORDER BY entry_bar", (day,))]
        for L_ in legs:
            L_["entry_time"], L_["exit_time"], L_["exit_reason"] = bar_hm(L_["entry_bar"]), bar_hm(L_["exit_bar"]), WHY.get(L_["why"], str(L_["why"]))
            for k in ("entry", "exit", "gross", "costs", "net"):
                L_[k] = round(float(L_[k]), 2)
        out["book_a"]["legs"] = legs
        out["book_a"]["net"] = round(sum(L_["net"] for L_ in legs), 2) if legs else None
        for e in con.execute("SELECT kind, at, bar, value, info FROM livex_events WHERE day=? ORDER BY at", (day,)):
            info = {}
            try:
                info = json.loads(e["info"]) if e["info"] else {}
            except Exception:  # noqa: BLE001
                info = {"text": e["info"]}
            out["events"].append({"kind": e["kind"], "time": _hms(e["at"]), "bar": e["bar"], "bar_time": bar_hm(e["bar"]), "value": e["value"], "info": info})
    for r in con.execute("SELECT * FROM livex_fast WHERE day=? ORDER BY entry_at", (day,)):
        r = dict(r)
        out["book_b"].append({"book": r["book"], "leg": r["leg"], "symbol": r["symbol"], "side": r["side"], "qty": r["qty"], "entry": round(r["entry"], 2),
                              "entry_time": _hms(r["entry_at"]), "exit": None if r["exit"] is None else round(r["exit"], 2), "exit_time": _hms(r["exit_at"]),
                              "why": r["why"], "gross": r["gross"], "costs": r["costs"], "net": r["net"]})
    p = config.DATA / "manual_trades.json"
    if p.exists():
        out["trades"] = [m for m in json.loads(p.read_text()) if m.get("day") == date]
    out["marks"] = [dict(x) for x in con.execute("SELECT minute, phase, pick_ltp, pick_pnl, mkt_move, flip_ltp, flip_pnl, running_net, n_quotes FROM livex_marks WHERE day=? ORDER BY minute", (day,))]
    for m in out["marks"]:
        m["time"] = f"{m['minute'] // 60:02d}:{m['minute'] % 60:02d}"
    return out


def log_days() -> list[dict]:
    """Every session with anything recorded, newest first, with its Book A status and net: the log page's index."""
    con = _db()
    days = {int(x[0]) for x in con.execute("SELECT day FROM livex_days")}
    days |= {int(x[0]) for x in con.execute("SELECT DISTINCT day FROM livex_fast")}
    p = config.DATA / "manual_trades.json"
    if p.exists():
        for m in json.loads(p.read_text()):
            try:
                days.add((dt.date.fromisoformat(m["day"]) - dt.date(1970, 1, 1)).days)
            except Exception:  # noqa: BLE001
                pass
    net = dict(con.execute("SELECT day, SUM(net) FROM livex_trades GROUP BY day").fetchall())
    st = dict(con.execute("SELECT day, status FROM livex_days").fetchall())
    skip = dict(con.execute("SELECT day, skip FROM livex_days").fetchall())
    return [{"day": day_to_date(x).isoformat(), "weekday": day_to_date(x).strftime("%a"), "status": st.get(x), "skip": bool(skip.get(x)),
             "book_a_net": None if net.get(x) is None else round(float(net[x]), 2)} for x in sorted(days, reverse=True)]


def report() -> dict:
    con = _db()
    D = pd.read_sql_query("SELECT * FROM livex_days ORDER BY day", con)
    T = pd.read_sql_query("SELECT * FROM livex_trades", con)
    daily = T.groupby("day").net.sum().reindex(D[D.status == "settled"].day, fill_value=0.0)
    mo = daily.groupby(pd.to_datetime(daily.index, unit="D").to_period("M")).sum()
    eq = daily.cumsum()
    mk = con.execute("SELECT * FROM livex_marks WHERE day=? ORDER BY minute DESC LIMIT 1", (live.today_ist(),)).fetchone()
    marks = [dict(x) for x in con.execute("SELECT minute, running_net, mkt_move, pick_ltp FROM livex_marks WHERE day=? ORDER BY minute", (live.today_ist(),))]
    adm = {int(x[0]) for x in con.execute("SELECT DISTINCT day FROM livex_events WHERE kind='admin_reverse'")}  # the admin's hand, not the rule's flip
    S = D[D.status == "settled"]  # counts are of finished sessions; today joins them once settled
    ev_today = [{"kind": k, "at": at, "bar": bar, "value": val} for k, at, bar, val in
                con.execute("SELECT kind, at, bar, value FROM livex_events WHERE day=? ORDER BY at", (live.today_ist(),))]
    mkd = dict(mk) if mk else None
    if mkd is not None:
        try:
            mkd["legs"] = json.loads(mkd["legs"]) if mkd.get("legs") else None
        except Exception:  # noqa: BLE001
            mkd["legs"] = None
    return {"mark": mkd, "marks_today": marks,
            "sessions": {k: int(v) for k, v in D.status.value_counts().items()}, "skip_days": int(S.skip.fillna(0).sum()),
            "flip_days": int(S[(S.skip.fillna(0) == 0) & ~S.day.isin(adm)].flip.fillna(0).sum()), "admin_days": int(S.day.isin(adm).sum()),
            "events_today": ev_today,
            "net_rs": round(float(daily.sum())), "pct_of_book": round(float(daily.sum() / BOOK * 100), 2),
            "per_month_pct": {str(k): round(float(v / BOOK * 100), 2) for k, v in mo.items()},
            "day_win_rate": round(float((daily > 0).mean()), 3) if len(daily) else None, "worst_day_rs": round(float(daily.min())) if len(daily) else None,
            "max_fall_rs": round(float((eq.cummax().clip(lower=0) - eq).max())) if len(daily) else None,
            "days": [{"day": day_to_date(int(r.day)).isoformat(), "pick": r.pick, "skip": bool(r.skip), "flip": r.flip_symbol if r.flip and not r.skip else None,
                      "net": round(float(daily.get(r.day, 0.0)))} for r in D.itertuples()][-15:]}


def all_books(manual: list[dict]) -> dict:
    """Every paper book together, by session: Book A's settled days (a regime skip counts as ₹0) plus the active and
    manual paper trades that have closed, on their own day. The admin's headline; each book keeps its own record, and
    open positions are left out until they close (the live strip shows them)."""
    con = _db()
    D = pd.read_sql_query("SELECT day, status FROM livex_days ORDER BY day", con)
    T = pd.read_sql_query("SELECT day, net FROM livex_trades", con)
    a = T.groupby("day").net.sum()
    book_a = {int(d): float(a.get(d, 0.0)) for d in D[D.status == "settled"].day}
    # "active" = the automatic all-day scan book (its entries are the program's, whoever closed them);
    # "manual" = trades the admin asked for by hand
    by: dict[str, dict[int, float]] = {"active": {}, "manual": {}}
    n_by = {"active": 0, "manual": 0}
    n_open = 0
    for m in manual:
        if m.get("status") == "open":
            n_open += 1
            continue
        if m.get("status") != "closed" or m.get("net") is None:
            continue
        k = "active" if m.get("book") == "active" else "manual"
        d = (dt.date.fromisoformat(str(m["day"])) - dt.date(1970, 1, 1)).days
        by[k][d] = by[k].get(d, 0.0) + float(m["net"])
        n_by[k] += 1
    act, man = by["active"], by["manual"]
    days = sorted(set(book_a) | set(act) | set(man))
    if not days:
        return {"net_rs": 0.0, "book_a_rs": 0.0, "active_rs": 0.0, "manual_rs": 0.0, "other_rs": 0.0, "sessions": 0, "active_trades": 0,
                "manual_trades": 0, "other_trades": 0, "open_trades": n_open, "win_rate": None, "worst_day_rs": None, "max_fall_rs": None, "days": []}
    tot = pd.Series([book_a.get(d, 0.0) + act.get(d, 0.0) + man.get(d, 0.0) for d in days], index=days)
    # Net and the split count every closed trade at once; the day-level figures (sessions, winning days, worst day,
    # largest fall) only finished days: today joins them once Book A has settled it, never as a half day with Book A at 0.
    today = live.today_ist()
    fin = tot.loc[[d for d in days if d < today or d in book_a]]
    eq = fin.cumsum()
    return {"net_rs": round(float(tot.sum()), 2), "book_a_rs": round(sum(book_a.values()), 2), "active_rs": round(sum(act.values()), 2),
            "manual_rs": round(sum(man.values()), 2), "other_rs": round(sum(act.values()) + sum(man.values()), 2),
            "sessions": len(fin), "today_open_day": bool(days and days[-1] >= today and days[-1] not in book_a),
            "active_trades": n_by["active"], "manual_trades": n_by["manual"], "other_trades": n_by["active"] + n_by["manual"],
            "open_trades": n_open, "win_rate": round(float((fin > 0).mean()), 3) if len(fin) else None,
            "worst_day_rs": round(float(fin.min()), 2) if len(fin) else None,
            "max_fall_rs": round(float((eq.cummax().clip(lower=0) - eq).max()), 2) if len(fin) else None,
            "days": [{"day": day_to_date(d).isoformat(), "book_a": round(book_a.get(d, 0.0), 2), "active": round(act.get(d, 0.0), 2),
                      "manual": round(man.get(d, 0.0), 2), "other": round(act.get(d, 0.0) + man.get(d, 0.0), 2), "total": round(float(tot[d]), 2)}
                     for d in days]}


# ------------------------------------------------------------ live executor (the website's real-money mirror of book A)
def bar_close_minute(i: int) -> int:
    """IST minute at which 5-minute bar i closes (bar 0 closes 09:20, FLIP_BAR 10:15, EXIT_BAR 15:15)."""
    return config.SESSION_OPEN + 5 * (i + 1)


def mstop_bar_due(now: float | None = None) -> int | None:
    """The bar (1..MSTOP_LAST_BAR) whose close was MSTOP_WINDOW_S seconds ago, or None."""
    m = live.minute_ist(now)
    i = int((m - config.SESSION_OPEN) // 5) - 1
    if not 1 <= i <= MSTOP_LAST_BAR:
        return None
    since = (m - bar_close_minute(i)) * 60.0
    return i if MSTOP_WINDOW_S[0] <= since <= MSTOP_WINDOW_S[1] else None


def market_stop_check(now: float | None = None, con=None) -> dict:
    """Book A's market stop, live, for the website's executor: at each 5-minute close from 09:25 to 15:10, the average
    stock's move since the 09:20 close, with Groww's live prices a few seconds after the close standing in for the bar's
    close (`settle` still prices the paper record from the bars, so the two can differ by a bar now and then). Once the
    move reaches MSTOP the short is to be covered: recorded ONCE as the day's 'mstop' event in livex_events. Every
    completed check also refreshes the day's 'mstop_check' row: the watcher's heartbeat, which the executor watches so
    a dead or blind watcher never leaves a real short without its stop.
    'checked' False: not at a bar close, or too few quotes (the session loop tries again within the window)."""
    now = now if now is not None else time.time()
    i = mstop_bar_due(now)
    if i is None:
        return {"checked": False, "why": "not at a bar close"}
    day = live.today_ist(now)
    con = con if con is not None else _db()
    r = con.execute("SELECT status, skip, pick, flip FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] not in ("decided", "flipped") or r[1] or not r[2]:
        return {"checked": True, "bar": i, "why": "no open short"}
    if r[0] == "flipped" and r[3] and i > FLIP_BAR:
        return {"checked": True, "bar": i, "why": "the short was covered by the 10:15 flip"}
    if con.execute("SELECT 1 FROM livex_events WHERE day=? AND kind='mstop'", (day,)).fetchone():
        return {"checked": True, "bar": i, "why": "already stopped"}
    px0 = {s_: float(p) for s_, p in con.execute("SELECT symbol, px_0920 FROM livex_rows WHERE day=?", (day,)) if p}
    q = _ltp_many(list(px0))
    moves = [q[s_] / p - 1 for s_, p in px0.items() if q.get(s_) and q[s_] > 0]
    if not px0 or len(moves) < max(live.MIN_ROWS, 0.8 * len(px0)):
        return {"checked": False, "bar": i, "why": f"only {len(moves)} of {len(px0)} quotes"}
    mkt = float(np.mean(moves))
    out = {"checked": True, "bar": i, "mkt": round(mkt, 5), "stop": mkt >= MSTOP}
    info = json.dumps({"quotes": len(moves), "rows": len(px0), "pick": r[2], "pick_ltp": q.get(r[2])})
    with con:
        con.execute("INSERT OR REPLACE INTO livex_events(day, kind, at, bar, value, info) VALUES(?,?,?,?,?,?)",
                    (day, "mstop_check", time.time(), i, mkt, info))
        if mkt >= MSTOP:
            con.execute("INSERT OR IGNORE INTO livex_events(day, kind, at, bar, value, info) VALUES(?,?,?,?,?,?)",
                        (day, "mstop", time.time(), i, mkt, info))
    if mkt >= MSTOP:
        m = bar_close_minute(i)
        log(f"MARKET STOP at the {m // 60:02d}:{m % 60:02d} close: the average stock is up {mkt:.2%} since 09:20 — cover the short")
    return out


def today_state(now: float | None = None) -> dict:
    """Today's book A decisions for the website's executor: the 09:20 pick, the 10:15 flip (only when decided live) and the
    market stop. Read-only: it never creates or migrates a table, so polling it every few seconds costs no write."""
    import sqlite3

    now = now if now is not None else time.time()
    day = live.today_ist(now)
    out = {"as_of": now, "day": day, "date": day_to_date(day).isoformat(), "minute": round(live.minute_ist(now), 4),
           "status": None, "skip": None, "pick": None, "pick_px": None, "decided_at": None, "late": False,
           "flip": None, "mstop": None, "mstop_check": None, "settled_at": None, "last_mark_at": None, "book": BOOK,
           "mstop_at": MSTOP}
    with db.tx() as con:
        try:
            r = con.execute("SELECT status, skip, pick, pick_px, decided_at, flip_at, flip, flip_symbol, flip_px, settled_at, info "
                            "FROM livex_days WHERE day=?", (day,)).fetchone()
        except sqlite3.OperationalError:  # no livex table yet: nothing decided
            return out
        if r:
            try:
                info = json.loads(r[10]) if r[10] else {}
            except ValueError:
                info = {}
            out.update(status=r[0], skip=None if r[1] is None else bool(r[1]), pick=r[2], pick_px=r[3], decided_at=r[4],
                       late=bool(info.get("late")), settled_at=r[9])
            if r[5] is not None and r[6] is not None:  # decided live at 10:15, not worked out later by settle()
                out["flip"] = {"at": r[5], "do": bool(r[6]), "symbol": r[7], "px": r[8]}
        try:
            for kind, at, bar, value in con.execute("SELECT kind, at, bar, value FROM livex_events WHERE day=? AND kind IN ('mstop', 'mstop_check')", (day,)):
                out[kind] = {"at": at, "bar": bar, "move": value}
        except sqlite3.OperationalError:  # the events table arrives with the first session after this release
            pass
        try:
            mk = con.execute("SELECT MAX(at) FROM livex_marks WHERE day=?", (day,)).fetchone()
            out["last_mark_at"] = mk[0] if mk else None
        except sqlite3.OperationalError:
            pass
    return out


# ------------------------------------------------------------ parity with the backtest engine
def replay(day: int, models: dict | None = None) -> dict:
    """Run the whole day (09:20 decision, 10:15 flip, settlement) from stored data for a PAST session, as the live code
    would have, and return the legs and the net; compare with exp/search's engine for the same variant."""
    date = day_to_date(day)
    models = models or load_models(date.year)
    d = dtm.load()
    p = d["p"]
    keep = p.days < day
    t = int(np.searchsorted(p.days, day))
    assert p.days[t] == day, "no daily bar for that day"
    opens_full = {s: float(p.O[t, j]) for j, s in enumerate(p.symbols) if np.isfinite(p.O[t, j])}
    bench_open = float(p.bench_o[t])
    d = {**d, "p": type(p)(p.days[keep], p.symbols, p.O[keep], p.H[keep], p.L[keep], p.C[keep], p.V[keep], p.bench_o[keep], p.bench_c[keep], p.actions),
         "deliv": d["deliv"][keep], "oi": {k: v[keep] for k, v in d["oi"].items()}}
    syms = live.candidates(d, day)
    hab = habits(syms, day)
    bars, P = {}, {}
    for s in syms + ["NIFTY"]:
        x = load_frame(s, 5)
        if x is None or not len(x):
            continue
        fb = live.first_bar(x, day)
        if fb is not None:
            bars[s] = fb
        if s != "NIFTY":
            a = live.paths(x, day)
            if a is not None:
                P[s] = a
    nf = nifty_first(day, bars.pop("NIFTY", None))
    opens = {s: v for s, v in opens_full.items() if s in bars}
    df = full_features(d, day, bars, bench_open, hab, nf, models, opens=opens)
    flags = regime_flags(models, day, nf[1], float(df.m_first_up.iloc[0]))
    pick = df.sort_values("score", kind="stable").iloc[0]
    P = {s: a for s, a in P.items() if s in set(df.symbol)}
    legs = price_day(day, pick.symbol, flags["skip"], P)
    return {"day": date.isoformat(), "rows": int(len(df)), "pick": pick.symbol, "skip": flags["skip"], "flags": flags,
            "legs": [(l_["leg"], l_["symbol"], round(l_["net"], 2), WHY.get(l_["why"])) for l_ in legs], "net": round(sum(l_["net"] for l_ in legs), 2)}
