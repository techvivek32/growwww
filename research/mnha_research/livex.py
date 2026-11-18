"""Live PAPER trading of the strategy chosen for 2026 by the 1-lakh search (no auction, no overnight):

  09:20  score every liquid F&O stock with the ENS3 score: the session z-score average of three walk-forward
         gradient-boosting models (features F_STAGE2 / F_STAGE2+F_EXTRA / F_STAGE2+first-bar volume), and
         short the 1 lowest with the whole Rs 5L — unless the session is a REGIME SKIP day (at least 2 of:
         NIFTY gap in the top 20% of earlier sessions, first-bar breadth in the top 20%, Monday).
  bar i  MARKET STOP: cover at the bar's close once the average stock is up 0.5% since the 09:20 close.
  10:15  FLIP: if the median stock is up more than 0.25% since the open, cover the short at the 10:15 close
         and buy the day's top gainer (price >= Rs 50) with Rs 5L, held to 15:15.
  15:15  square off.

NO ORDER IS EVER SENT. This module reads Groww market data and writes its own tables (prefix livex_).
It reuses live.py's data plumbing and reproduces exp/search's engine for this variant (checked by `parity`).
"""

from __future__ import annotations

import datetime as dt
import json
import math
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
"""
WHY = {0: "time", 5: "market stop", 6: "flip cover"}
log = live.log


def _db():
    con = live._db()
    con.executescript(SCHEMA)
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


def train(year: int | None = None) -> dict:
    """Freeze the three ENS3 models for `year`, each fitted on every panel session before 1 January `year`."""
    Y = year or day_to_date(live.today_ist()).year
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
def decide(wait: bool = True) -> dict:
    now = time.time()
    day = live.today_ist(now)
    date = day_to_date(day)
    con = _db()
    if con.execute("SELECT 1 FROM livex_days WHERE day=? AND status IN ('decided','flipped','settled')", (day,)).fetchone():
        return {"day": date.isoformat(), "status": "already decided"}
    if date.weekday() >= 5:
        return {"day": date.isoformat(), "status": "weekend"}
    models = load_models(date.year)
    late = live.minute_ist(now) > 9 * 60 + 35
    d = dtm.load()
    if late and d["p"].days[-1] >= day:
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
    log(f"livex decide {date}: {len(syms)} candidates, habits for {len(hab)}; waiting for the 09:15 bar")
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
        con.execute("INSERT OR REPLACE INTO livex_days(day, status, info) VALUES(?,?,?)", (day, "no_session", json.dumps({"bars": len(bars)})))
        con.commit()
        return {"day": date.isoformat(), "status": "no session (holiday?)"}
    bench = bars.pop(config.BENCHMARK, None)
    nf = nifty_first(day, bars.pop("NIFTY", None))
    df = full_features(d, day, bars, bench["o"] if bench else np.nan, hab, nf, models)
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
    r = con.execute("SELECT status, skip FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] != "decided":
        return {"status": f"nothing to do ({r[0] if r else 'not decided'})"}
    rows = [x[0] for x in con.execute("SELECT symbol FROM livex_rows WHERE day=?", (day,))]
    while live.minute_ist() < 10 * 60 + 15 + 0.5:
        time.sleep(2)
    P = _partial_paths(day, rows, FLIP_BAR)
    do, top, med = flip_decision(P)
    px = float(P[top][3, FLIP_BAR]) if do and top else None
    with con:
        con.execute("UPDATE livex_days SET status='flipped', flip_at=?, flip=?, flip_symbol=?, flip_px=? WHERE day=?", (time.time(), int(do), top, px, day))
    out = {"day": day_to_date(day).isoformat(), "median_since_open": round(med, 5), "flip": do,
           "action": (f"COVER the short, BUY {top} @ {px:.2f} (full book) till 15:15" if do and not r[1] else ("regime skip day" if r[1] else "no flip: hold the short"))}
    log(json.dumps(out))
    return out


def price_day(day: int, pick: str, skip: bool, P: dict[str, np.ndarray], flip_rec: tuple | None = None, slip_bps: float = lab.SLIP_BPS) -> list[dict]:
    """The day's legs priced exactly like exp/search/engine.day_pnl for this variant."""
    out = []
    if skip or pick not in P:
        return out
    R = np.stack([P[s][3] / P[s][3, 0] - 1 for s in P])
    mkt = R.mean(axis=0)
    do, top, _med = flip_rec if flip_rec is not None else flip_decision(P)
    xb = FLIP_BAR if do else EXIT_BAR
    a = P[pick]
    slip = max(slip_bps / 1e4, 0.5 * float(lab.tick_size(np.array([a[3, 0]]), np.array([day]))[0]) / float(a[3, 0]))
    e = a[3, 0] * (1 - slip)
    q = math.floor(BOOK / e)
    x, xbar, why = live._walk_live(a[0], a[1], a[2], a[3], -1, e, 0, xb, 0.0, slip, mkt, MSTOP)
    if xbar == xb and why == 0 and do:
        why = 6
    def leg(name, sym, side, q, e, x, eb, xbar, why):
        gross = (x - e) * q * side
        costs = float(trade_costs(np.array([q * e]), np.array([q * x]), np.array([side]), np.array([day]), True)[0])
        return {"leg": name, "symbol": sym, "side": side, "qty": q, "entry": float(e), "exit": float(x), "entry_bar": eb, "exit_bar": int(xbar),
                "why": int(why), "gross": float(gross), "costs": costs, "net": float(gross - costs)}
    out.append(leg("short", pick, -1, q, e, x, 0, xbar, why))
    if do and top and top in P:
        g = P[top]
        s2 = max(slip_bps / 1e4, 0.5 * float(lab.tick_size(np.array([g[3, FLIP_BAR]]), np.array([day]))[0]) / float(g[3, FLIP_BAR]))
        e2 = g[3, FLIP_BAR] * (1 + s2)
        q2 = math.floor(BOOK / e2)
        x2 = g[3, EXIT_BAR] * (1 - s2)
        out.append(leg("flip_long", top, 1, q2, e2, x2, FLIP_BAR, EXIT_BAR, 0))
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
    flip_rec = (bool(r[3]), r[4], np.nan) if r[0] == "flipped" else None
    legs = price_day(day, r[2], bool(r[1]), P, flip_rec)
    with con:
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


def mark() -> dict:
    """Every few minutes during the session: the open paper position marked at Groww's live prices (LTP), the
    average stock's move since 09:20 (the market stop watches 0.5%), and the flip leg. Informational: the day's
    official result is still `settle`, priced from the 5-minute bars."""
    now = time.time()
    day, minute = live.today_ist(now), int(live.minute_ist(now))
    if not (9 * 60 + 22 <= minute <= 15 * 60 + 20):
        return {"status": "outside 09:22-15:20 IST"}
    con = _db()
    r = con.execute("SELECT status, skip, pick, pick_px, flip, flip_symbol, flip_px FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] not in ("decided", "flipped"):
        return {"status": f"no open paper position ({r[0] if r else 'not decided'})"}
    status, skip, pick, pick_px, flip_on, flip_sym, flip_px = r
    rows = [x[0] for x in con.execute("SELECT symbol FROM livex_rows WHERE day=?", (day,))]
    px0 = dict(con.execute("SELECT symbol, px_0920 FROM livex_rows WHERE day=?", (day,)).fetchall())
    q = _ltp_many(rows)
    moves = [q[s_] / px0[s_] - 1 for s_ in rows if s_ in q and px0.get(s_)]
    mkt = float(np.mean(moves)) if moves else np.nan
    out = {"day": day_to_date(day).isoformat(), "time": f"{minute // 60:02d}:{minute % 60:02d}", "phase": "skip" if skip else status,
           "mkt_move_since_0920": round(mkt, 5), "market_stop_at": MSTOP, "quotes": len(q)}
    pick_pnl = flip_pnl = 0.0
    pq = fq = None
    if not skip and pick and pick in q:
        slip = max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([pick_px]), np.array([day]))[0]) / pick_px)
        e = pick_px * (1 - slip)
        pq = math.floor(BOOK / e)
        short_open = not (status == "flipped" and flip_on)
        pick_pnl = (e - q[pick]) * pq if short_open else None
        out["short"] = {"symbol": pick, "entry": round(e, 2), "ltp": q[pick], "qty": pq, "open": short_open,
                        "running_pnl": None if pick_pnl is None else round(pick_pnl, 2)}
    if flip_on and flip_sym:
        fl = q.get(flip_sym) or _ltp_many([flip_sym]).get(flip_sym)
        if fl:
            s2 = max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([flip_px]), np.array([day]))[0]) / flip_px)
            e2 = flip_px * (1 + s2)
            fq = math.floor(BOOK / e2)
            flip_pnl = (fl - e2) * fq
            out["flip_long"] = {"symbol": flip_sym, "entry": round(e2, 2), "ltp": fl, "qty": fq, "running_pnl": round(flip_pnl, 2)}
    running = (pick_pnl or 0.0) + (flip_pnl or 0.0)
    out["running_net_before_costs"] = round(running, 2)
    with con:
        con.execute("INSERT OR REPLACE INTO livex_marks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (day, now, minute, out["phase"], pick, out.get("short", {}).get("entry"), q.get(pick) if pick else None, pq,
                     pick_pnl if pick_pnl is not None else None, mkt if np.isfinite(mkt) else None, flip_sym,
                     out.get("flip_long", {}).get("entry"), out.get("flip_long", {}).get("ltp"), fq, flip_pnl or None, running, len(q)))
    log(json.dumps(out))
    return out


def report() -> dict:
    con = _db()
    D = pd.read_sql_query("SELECT * FROM livex_days ORDER BY day", con)
    T = pd.read_sql_query("SELECT * FROM livex_trades", con)
    daily = T.groupby("day").net.sum().reindex(D[D.status == "settled"].day, fill_value=0.0)
    mo = daily.groupby(pd.to_datetime(daily.index, unit="D").to_period("M")).sum()
    eq = daily.cumsum()
    mk = con.execute("SELECT * FROM livex_marks WHERE day=? ORDER BY minute DESC LIMIT 1", (live.today_ist(),)).fetchone()
    marks = [dict(x) for x in con.execute("SELECT minute, running_net, mkt_move, pick_ltp FROM livex_marks WHERE day=? ORDER BY minute", (live.today_ist(),))]
    return {"mark": dict(mk) if mk else None, "marks_today": marks,
            "sessions": {k: int(v) for k, v in D.status.value_counts().items()}, "skip_days": int(D.skip.fillna(0).sum()),
            "flip_days": int(D.flip.fillna(0).sum()), "net_rs": round(float(daily.sum())), "pct_of_book": round(float(daily.sum() / BOOK * 100), 2),
            "per_month_pct": {str(k): round(float(v / BOOK * 100), 2) for k, v in mo.items()},
            "day_win_rate": round(float((daily > 0).mean()), 3) if len(daily) else None, "worst_day_rs": round(float(daily.min())) if len(daily) else None,
            "max_fall_rs": round(float((eq.cummax().clip(lower=0) - eq).max())) if len(daily) else None,
            "days": [{"day": day_to_date(int(r.day)).isoformat(), "pick": r.pick, "skip": bool(r.skip), "flip": r.flip_symbol if r.flip else None,
                      "net": round(float(daily.get(r.day, 0.0)))} for r in D.itertuples()][-15:]}


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
