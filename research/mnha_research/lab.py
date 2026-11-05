"""Research lab for intraday cash-equity strategies on the liquid F&O stocks.

One shared, leak-checked dataset and one evaluation protocol, so that every
experiment is measured the same way and nobody fools themselves.

THE PANEL (built once by `build()`, read by `load()`): one row per (session,
stock) the daily model found eligible at the open, 2020-07 onward, with
  * every daily feature known at the open (daytrade.design: p_* ranks, raw
    gap/ATR, market state) and the stage-1 out-of-sample score `s1`;
  * the session's 5-minute bars 09:15 ... 15:10 as arrays (72 bars: bar b
    opens at 09:15 + 5b and closes 5 minutes later; bar 0 closes at 09:20,
    bar 71 closes at 15:15, the MIS square-off);
  * first-bar features (known at 09:20), the stock's intraday habits over the
    previous sessions (known before the open), NIFTY's gap and first bar,
    calendar and expiry.

THE PROTOCOL
  * Out-of-sample by construction: `walk_forward` refits once a year on every
    session before 1 January of the year it predicts.
  * Any choice among variants (exit time, K, stops, features...) must itself
    be made walk-forward: `select` trades in year Y the variant that was best
    on the test years before Y. Its result is the honest number. The best
    variant on the whole history is in-sample and must be labelled so.
  * SEALED: sessions on or after SEAL_DAY are not in the panel unless
    `load(final=True)`. Experiments never use final=True; it is evaluated once
    at the end.
  * Fills: entry at the close of the entry bar, exit at the close of the exit
    bar (or a stop / target inside a bar — stop first if both), adverse
    SLIP_BPS on every market fill, intraday costs per trade (costs.py).
    Unlevered: the positions open at any moment never exceed the capital
    given to the rule (default the ₹5 lakh book).
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass

import numpy as np
import pandas as pd
from numba import njit

from . import config, daytrade as dtm, quality
from .costs import trade_costs
from .series import load_frame
from .sessions import ist_day, ist_minute
from .validation import day_to_date

LAB = config.DATA / "lab"
START_DAY = (dt.date(2020, 7, 1) - dt.date(1970, 1, 1)).days
SEAL_DAY = (dt.date(2026, 5, 1) - dt.date(1970, 1, 1)).days
FIRST_TEST_YEAR = 2022
BOOK = 500_000.0
SLIP_BPS = 3.0
NB = 72  # 5-minute bars 09:15 .. 15:10 (closes 09:20 .. 15:15)
OPEN_M = config.SESSION_OPEN


def bar_close_minute(b: int) -> int:
    return OPEN_M + 5 * (b + 1)


def bar_of(hhmm: str) -> int:
    """The bar that CLOSES at hh:mm (e.g. '09:20' -> 0, '15:15' -> 71)."""
    h, m = (int(x) for x in hhmm.split(":"))
    return (h * 60 + m - OPEN_M) // 5 - 1


# ------------------------------------------------------------ build
def _expiry_days(days: np.ndarray) -> np.ndarray:
    """Trading days until the month's stock-derivative expiry (last Thursday
    until 2025-08, last Tuesday from 2025-09; moved to the trading day before
    when a holiday)."""
    dates = [day_to_date(int(d)) for d in days]
    out = np.zeros(len(days))
    by_month: dict[tuple[int, int], list[int]] = {}
    for i, x in enumerate(dates):
        by_month.setdefault((x.year, x.month), []).append(i)
    for (y, m), idx in by_month.items():
        wd = 3 if dt.date(y, m, 1) < dt.date(2025, 9, 1) else 1
        last = dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)
        while last.weekday() != wd:
            last -= dt.timedelta(days=1)
        exp = max((i for i in idx if dates[i] <= last), default=idx[-1])
        for i in idx:
            out[i] = exp - i if i <= exp else np.nan
    return out


def build() -> dict:
    """Write LAB/panel.parquet and LAB/paths.npz (all sessions, sealed ones included)."""
    LAB.mkdir(parents=True, exist_ok=True)
    d = dtm.load()
    des = dtm.design(d)
    p = d["p"]
    pred1 = np.load(config.DATA / "daytrade_pred_final.npy")
    D, S = p.C.shape
    elig = des["elig"] & (p.days >= START_DAY)[:, None] & np.isfinite(pred1)

    # per-stock daily summaries from 5-minute bars (every session, eligible or not)
    summ: dict[str, pd.DataFrame] = {}
    path_rows = []  # (t, j, o, h, l, c, v)
    for j, sym in enumerate(p.symbols):
        if not elig[:, j].any():
            continue
        x = load_frame(sym, 5)
        if x is None or x.empty:
            continue
        x, _steps, _ = quality.reconcile(x, load_frame(sym, 1440))
        xd = ist_day(x["time"].to_numpy(dtype=np.int64))
        xm = ist_minute(x["time"].to_numpy(dtype=np.int64))
        b = (xm - OPEN_M) // 5
        o, h, l, c, v = (x[k].to_numpy(dtype=np.float64) for k in ("open", "high", "low", "close", "volume"))
        days_u, start = np.unique(xd, return_index=True)
        ends = np.append(start[1:], len(xd))
        rows = []
        for dd, s0, s1 in zip(days_u, start, ends):
            bb = b[s0:s1]
            if bb[0] != 0:
                continue
            cc = c[s0:s1]
            vv = v[s0:s1]
            tp = (h[s0:s1] + l[s0:s1] + cc) / 3
            def close_at(k):
                m = np.nonzero(bb <= k)[0]
                return cc[m[-1]] if len(m) else np.nan
            vw = float((tp * vv).sum() / vv.sum()) if vv.sum() > 0 else np.nan
            rows.append((int(dd), o[s0], cc[0], close_at(bar_of("10:15")), close_at(bar_of("14:25")), close_at(NB - 1), cc[-1], vw, vv[0]))
            t = np.searchsorted(p.days, dd)
            if t < D and p.days[t] == dd and elig[t, j]:
                k = (bb >= 0) & (bb < NB)
                if k.sum() >= 60:
                    arr = np.full((5, NB), np.nan)
                    arr[0, bb[k]], arr[1, bb[k]], arr[2, bb[k]], arr[3, bb[k]], arr[4, bb[k]] = o[s0:s1][k], h[s0:s1][k], l[s0:s1][k], cc[k], vv[k]
                    # a missing bar: no trading in it — price carried forward, no volume
                    for q in range(1, NB):
                        if np.isnan(arr[3, q]):
                            arr[0:4, q] = arr[3, q - 1]
                            arr[4, q] = 0.0
                    if np.isfinite(arr[3]).all():
                        path_rows.append((t, j, arr.astype(np.float32)))
        sm = pd.DataFrame(rows, columns=["day", "o915", "c920", "c1015", "c1425", "c1515", "c_last", "vwap", "v_first"]).set_index("day")
        summ[sym] = sm
        dtm.log(f"lab build {sym}: {len(sm)} sessions")

    # NIFTY's gap and first bar
    nf = load_frame("NIFTY", 5)
    nday = ist_day(nf["time"].to_numpy(dtype=np.int64))
    nmin = ist_minute(nf["time"].to_numpy(dtype=np.int64))
    nfd = pd.DataFrame({"day": nday, "m": nmin, "o": nf["open"].to_numpy(), "c": nf["close"].to_numpy()})
    first = nfd[nfd.m == OPEN_M].set_index("day")
    lastc = nfd.groupby("day").c.last()
    nifty = pd.DataFrame({"n_first": first.c / first.o - 1, "n_gap": first.o / lastc.shift(1) - 1})

    rows_t = np.array([r[0] for r in path_rows])
    rows_j = np.array([r[1] for r in path_rows])
    paths = np.stack([r[2] for r in path_rows])  # (N, 5, NB)
    order = np.lexsort((rows_j, rows_t))
    rows_t, rows_j, paths = rows_t[order], rows_j[order], paths[order]
    df = pd.DataFrame({"t": rows_t, "j": rows_j, "day": p.days[rows_t], "symbol": [p.symbols[j] for j in rows_j]})
    for k in dtm.RANKED:
        df[f"p_{k}"] = des["x"][f"p_{k}"][rows_t, rows_j]
    for k in dtm.RAW:
        df[k] = des["x"][k][rows_t, rows_j]
    for k in dtm.MARKET:
        df[k] = des["m"][k][rows_t]
    df["s1_raw"] = pred1[rows_t, rows_j]
    df["daily_o"], df["daily_c1"] = p.O[rows_t, rows_j], dtm._lag(p.C)[rows_t, rows_j]

    o0, h0, l0, c0, v0 = paths[:, 0, 0], paths[:, 1, 0], paths[:, 2, 0], paths[:, 3, 0], paths[:, 4, 0]
    with np.errstate(divide="ignore", invalid="ignore"):
        df["first_ret"] = c0 / o0 - 1
        df["first_rng"] = (h0 - l0) / o0 / df["atr_pct_raw"].to_numpy()
        df["first_loc"] = np.where(h0 > l0, (c0 - l0) / (h0 - l0), 0.5)
        df["gap920"] = (1 + df["gap_raw"].to_numpy()) * (1 + df["first_ret"].to_numpy()) - 1
        # the stock's own intraday habits, from sessions before this one
        prev = {}
        for sym, sm in summ.items():
            sm = sm.sort_index()
            gap = sm.o915 / sm.c_last.shift(1) - 1
            oc = sm.c1515 / sm.c920 - 1
            f = pd.DataFrame(index=sm.index)
            f["im5"] = oc.rolling(5, min_periods=3).mean().shift(1)
            f["im20"] = oc.rolling(20, min_periods=10).mean().shift(1)
            f["rev20"] = (-np.sign(gap) * oc).rolling(20, min_periods=10).mean().shift(1)
            f["on5"] = gap.rolling(5, min_periods=3).mean().shift(1)
            f["on20"] = gap.rolling(20, min_periods=10).mean().shift(1)
            f["pd_last_hour"] = (sm.c_last / sm.c1425 - 1).shift(1)
            f["pd_vwap"] = (sm.c_last / sm.vwap - 1).shift(1)
            f["pd_first_hour"] = (sm.c1015 / sm.o915 - 1).shift(1)
            f["first_relvol"] = sm.v_first / sm.v_first.rolling(20, min_periods=10).mean().shift(1)
            f["symbol"] = sym
            prev[sym] = f.reset_index()
        pv = pd.concat(prev.values(), ignore_index=True)
    df = df.merge(pv, on=["day", "symbol"], how="left")
    df = df.merge(nifty, left_on="day", right_index=True, how="left")
    g = df.groupby("day")["first_ret"]
    df["m_first_med"] = g.transform("median")
    df["m_first_up"] = df.groupby("day")["first_ret"].transform(lambda s: (s > 0).mean())
    df["m_first_disp"] = g.transform("std")
    df["s1"] = df.groupby("day")["s1_raw"].rank(pct=True)
    for k in ("first_ret", "first_rng", "first_relvol", "gap920", "im5", "im20", "rev20", "on5", "on20",
              "pd_last_hour", "pd_vwap", "pd_first_hour", "first_loc"):
        df[f"r_{k}"] = df.groupby("day")[k].rank(pct=True)
    ud = np.unique(df.day.to_numpy())
    exp = pd.Series(_expiry_days(ud), index=ud)
    df["to_expiry"] = df.day.map(exp)
    df["dom"] = [day_to_date(int(x)).day for x in df.day]
    df.to_parquet(LAB / "panel.parquet", index=False)
    np.savez(LAB / "paths.npz", paths=paths)
    return {"rows": int(len(df)), "sessions": int(df.day.nunique()), "symbols": int(df.symbol.nunique()),
            "from": day_to_date(int(df.day.min())).isoformat(), "to": day_to_date(int(df.day.max())).isoformat()}


# ------------------------------------------------------------ load
@dataclass
class Lab:
    df: pd.DataFrame  # one row per (session, stock); features and keys
    o: np.ndarray  # (N, NB) 5-minute opens
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    v: np.ndarray
    year: np.ndarray
    final: bool


# Features known at 09:20 (the stage-2 set plus the lab's additions).
F_STAGE2 = (["s1", "s1_raw", "first_ret", "r_first_rng", "r_first_relvol", "r_gap920"]
            + [f"p_{k}" for k in dtm.RANKED] + dtm.RAW + dtm.MARKET)
F_EXTRA = ["first_loc", "r_first_loc", "first_rng", "first_relvol", "gap920", "im5", "im20", "rev20", "on5", "on20",
           "pd_last_hour", "pd_vwap", "pd_first_hour", "r_im5", "r_im20", "r_rev20", "r_on5", "r_on20",
           "r_pd_last_hour", "r_pd_vwap", "r_pd_first_hour", "n_first", "n_gap", "m_first_med", "m_first_up",
           "m_first_disp", "to_expiry", "dom"]


def load(final: bool = False) -> Lab:
    df = pd.read_parquet(LAB / "panel.parquet")
    paths = np.load(LAB / "paths.npz")["paths"]
    keep = np.ones(len(df), dtype=bool) if final else (df.day.to_numpy() < SEAL_DAY)
    df = df[keep].reset_index(drop=True)
    paths = paths[keep]
    year = np.array([day_to_date(int(x)).year for x in df.day.to_numpy()])
    return Lab(df, paths[:, 0], paths[:, 1], paths[:, 2], paths[:, 3], paths[:, 4], year, final)


# ------------------------------------------------------------ labels and models
def ret(lab: Lab, entry_bar: int = 0, exit_bar: int = NB - 1) -> np.ndarray:
    """Close-to-close return from the entry bar to the exit bar (no costs)."""
    return lab.c[:, exit_bar] / lab.c[:, entry_bar] - 1


def demean(lab: Lab, y: np.ndarray, clip: float = 0.10) -> np.ndarray:
    s = pd.Series(y).groupby(lab.df.day.to_numpy()).transform("mean").to_numpy()
    return np.clip(y - s, -clip, clip)


def walk_forward(lab: Lab, X: np.ndarray, y: np.ndarray, make_model, first_test_year: int = FIRST_TEST_YEAR,
                 fit_kwargs=None) -> np.ndarray:
    """Out-of-sample predictions: year Y is predicted by a model fitted on every
    row of earlier years (rows with a finite target)."""
    pred = np.full(len(X), np.nan)
    for Y in sorted(set(lab.year[lab.year >= first_test_year])):
        tr = (lab.year < Y) & np.isfinite(y)
        te = lab.year == Y
        if tr.sum() < 1000 or not te.any():
            continue
        m = make_model()
        m.fit(X[tr], y[tr], **(fit_kwargs or {}))
        pred[te] = m.predict_proba(X[te])[:, 1] if hasattr(m, "predict_proba") and getattr(m, "_lab_proba", False) else m.predict(X[te])
    return pred


def matrix(lab: Lab, cols: list[str]) -> np.ndarray:
    return lab.df[cols].to_numpy(dtype=np.float32)


# ------------------------------------------------------------ fills
@njit(cache=True)
def _walk(o, h, l, c, side, entry_bar, exit_bar, stop, target, trail, slip):
    """One position along one session's bars. side +1 long, -1 short.
    stop/target/trail are fractions of the entry price (0 = none).
    Returns (entry px, exit px, exit bar, reason 0 time / 1 stop / 2 target)."""
    e = c[entry_bar] * (1.0 + slip * side)
    if side > 0:
        sp = e * (1.0 - stop) if stop > 0 else -np.inf
        tp = e * (1.0 + target) if target > 0 else np.inf
    else:
        sp = e * (1.0 + stop) if stop > 0 else np.inf
        tp = e * (1.0 - target) if target > 0 else -np.inf
    best = e
    for i in range(entry_bar + 1, exit_bar + 1):
        if side > 0:
            if o[i] <= sp:
                return e, o[i] * (1.0 - slip), i, 1
            if o[i] >= tp:
                return e, o[i], i, 2
            if l[i] <= sp:
                return e, sp * (1.0 - slip), i, 1
            if h[i] >= tp:
                return e, tp, i, 2
            if trail > 0:
                if c[i] > best:
                    best = c[i]
                ns = best * (1.0 - trail)
                if ns > sp:
                    sp = ns
        else:
            if o[i] >= sp:
                return e, o[i] * (1.0 + slip), i, 1
            if o[i] <= tp:
                return e, o[i], i, 2
            if h[i] >= sp:
                return e, sp * (1.0 + slip), i, 1
            if l[i] <= tp:
                return e, tp, i, 2
            if trail > 0:
                if c[i] < best:
                    best = c[i]
                ns = best * (1.0 + trail)
                if ns < sp:
                    sp = ns
    return e, c[exit_bar] * (1.0 - slip * side), exit_bar, 0


@njit(cache=True)
def _walk_many(O, H, L, C, rows, sides, entry_bar, exit_bar, stop, target, trail, slip):
    n = len(rows)
    out = np.empty((n, 4))
    for k in range(n):
        r = rows[k]
        a, b, cbar, why = _walk(O[r], H[r], L[r], C[r], sides[k], entry_bar, exit_bar, stop, target, trail, slip)
        out[k, 0], out[k, 1], out[k, 2], out[k, 3] = a, b, cbar, why
    return out


@njit(cache=True)
def _walk_rows(O, H, L, C, rows, sides, entry_bar, exit_bar, stop, target, trail, slips):
    """_walk_many with a slippage fraction per row."""
    n = len(rows)
    out = np.empty((n, 4))
    for k in range(n):
        r = rows[k]
        a, b, cbar, why = _walk(O[r], H[r], L[r], C[r], sides[k], entry_bar, exit_bar, stop, target, trail, slips[k])
        out[k, 0], out[k, 1], out[k, 2], out[k, 3] = a, b, cbar, why
    return out


TICK_CHANGE_DAY = (dt.date(2024, 6, 10) - dt.date(1970, 1, 1)).days  # NSE: 1 paisa tick below Rs 250 from here


def tick_size(price: np.ndarray, day: np.ndarray) -> np.ndarray:
    """NSE equity tick: Rs 0.05, and Rs 0.01 for prices below Rs 250 from 2024-06-10."""
    return np.where((np.asarray(day) >= TICK_CHANGE_DAY) & (np.asarray(price) < 250.0), 0.01, 0.05)


def fill_slip(lab: Lab, rows: np.ndarray, bar: int, slip_bps: float = SLIP_BPS) -> np.ndarray:
    """Slippage fraction per market fill: slip_bps, and at least half a tick at the price of `bar`
    (a market order crosses the spread; on a Rs 10 stock one 0.05 tick is 50 bps)."""
    rows = np.asarray(rows, dtype=np.int64)
    px = lab.c[rows, bar].astype(np.float64)
    half_tick = 0.5 * tick_size(px, lab.df.day.to_numpy()[rows]) / np.where(px > 0, px, np.nan)
    return np.maximum(slip_bps / 1e4, np.nan_to_num(half_tick, nan=slip_bps / 1e4))


def simulate(lab: Lab, score: np.ndarray, k_short: int = 3, k_long: int = 0, entry_bar: int = 0, exit_bar: int = NB - 1,
             stop: float = 0.0, target: float = 0.0, trail: float = 0.0, capital: float = BOOK, mask: np.ndarray | None = None,
             min_short: float | None = None, min_long: float | None = None, weights: np.ndarray | None = None,
             slip_bps: float = SLIP_BPS, cost_mult: float = 1.0, tick_aware: bool = True) -> pd.DataFrame:
    """Each session: short the k_short LOWEST scores and buy the k_long HIGHEST
    among rows with a finite score (and `mask`), entering at the close of
    `entry_bar`, out by `exit_bar`. Slots are capital / (k_short + k_long), or
    capital * weights (per row, summing to <= 1 per session) when given.
    min_short / min_long: only take names whose score is beyond them.
    Slippage per market fill: slip_bps, but never less than half the exchange tick
    (`fill_slip`) unless tick_aware=False."""
    df = lab.df
    sc = np.where(np.isfinite(score) & (mask if mask is not None else True), score, np.nan)
    day = df.day.to_numpy()
    sel_rows, sel_side = [], []
    s = pd.Series(sc)
    if k_short:
        r = s.groupby(day).rank(method="first", ascending=True).to_numpy()
        m = r <= k_short
        if min_short is not None:
            m &= sc <= min_short
        sel_rows.append(np.nonzero(m)[0])
        sel_side.append(-np.ones(int(m.sum()), dtype=np.int64))
    if k_long:
        r = s.groupby(day).rank(method="first", ascending=False).to_numpy()
        m = r <= k_long
        if min_long is not None:
            m &= sc >= min_long
        sel_rows.append(np.nonzero(m)[0])
        sel_side.append(np.ones(int(m.sum()), dtype=np.int64))
    if not sel_rows:
        return _empty()
    rows = np.concatenate(sel_rows).astype(np.int64)
    sides = np.concatenate(sel_side)
    if not len(rows):
        return _empty()
    slips = fill_slip(lab, rows, entry_bar, slip_bps) if tick_aware else np.full(len(rows), slip_bps / 1e4)
    res = _walk_rows(lab.o, lab.h, lab.l, lab.c, rows, sides, entry_bar, exit_bar, stop, target, trail, slips)
    slot = capital * weights[rows] if weights is not None else np.full(len(rows), capital / (k_short + k_long))
    qty = np.floor(slot / res[:, 0])
    T = pd.DataFrame({"row": rows, "day": day[rows], "symbol": df.symbol.to_numpy()[rows], "side": sides, "qty": qty,
                      "entry": res[:, 0], "exit": res[:, 1], "exit_bar": res[:, 2].astype(int), "why": res[:, 3].astype(int),
                      "score": sc[rows], "entry_bar": entry_bar})
    T = T[T.qty > 0].reset_index(drop=True)
    ev, xv = (T.qty * T.entry).to_numpy(), (T.qty * T.exit).to_numpy()
    T["gross"] = (T.exit - T.entry) * T.qty * T.side
    T["costs"] = trade_costs(ev, xv, T.side.to_numpy(), T.day.to_numpy(), True) * cost_mult
    T["net"] = T.gross - T.costs
    T["notional"] = ev
    return T


def _empty() -> pd.DataFrame:
    return pd.DataFrame(columns=["row", "day", "symbol", "side", "qty", "entry", "exit", "exit_bar", "why", "score", "entry_bar",
                                 "gross", "costs", "net", "notional"])


# ------------------------------------------------------------ results
def stats(T: pd.DataFrame, book: float = BOOK) -> dict:
    """₹ results on a fixed book (no compounding)."""
    if T is None or len(T) == 0:
        return {"trades": 0}
    daily = T.groupby("day").net.sum().sort_index()
    eq = book + daily.cumsum()
    peak = np.maximum.accumulate(np.concatenate([[book], eq.to_numpy()]))[1:]
    mo = pd.to_datetime(daily.index.to_numpy(), unit="D").to_period("M")
    months = daily.groupby(mo).sum()
    allm = pd.period_range(months.index.min(), months.index.max(), freq="M")
    months = months.reindex(allm, fill_value=0.0)
    yr = pd.to_datetime(T.day, unit="D").dt.year
    sd = daily.std(ddof=1)
    gross_bps = float((T.gross / T.notional).mean() * 1e4) if "notional" in T else None
    return {
        "trades": int(len(T)), "sessions": int(len(daily)),
        "per_month_pct": float(months.mean() / book), "median_month_pct": float(months.median() / book),
        "month_win_rate": float((months > 0).mean()), "trade_win_rate": float((T.net > 0).mean()),
        "day_win_rate": float((daily > 0).mean()),
        "max_dd_pct": float(np.max((peak - eq.to_numpy()) / peak)),
        "worst_month_pct": float(months.min() / book), "best_month_pct": float(months.max() / book),
        "sharpe": float(daily.mean() / sd * math.sqrt(252)) if sd > 0 else None,
        "net": float(T.net.sum()), "net_bps_per_trade": float((T.net / T.notional).mean() * 1e4) if "notional" in T else None,
        "gross_bps_per_trade": gross_bps,
        "by_year_pct": {str(k): round(float(v) / book, 4) for k, v in T.groupby(yr).net.sum().items()},
        "months": int(len(months)),
    }


def monthly(T: pd.DataFrame, book: float = BOOK) -> dict:
    daily = T.groupby("day").net.sum()
    mo = pd.to_datetime(daily.index.to_numpy(), unit="D").to_period("M")
    return {str(k): round(float(v) / book, 4) for k, v in daily.groupby(mo).sum().items()}


def select(variants: dict[str, pd.DataFrame], first_year: int = FIRST_TEST_YEAR, metric: str = "sharpe",
           book: float = BOOK) -> dict:
    """Walk-forward selection: year Y trades the variant whose `metric`
    ('sharpe' of daily ₹, or 'mean' daily ₹) was best over test years
    [first_year, Y). The concatenation is the honest result of choosing among
    the variants; the first test year only trains the choice."""
    years = sorted({int(y) for T in variants.values() if len(T) for y in pd.to_datetime(T.day, unit="D").dt.year})
    years = [y for y in years if y > first_year]
    picked, choices = [], []
    yr_cache = {n: pd.to_datetime(T.day, unit="D").dt.year.to_numpy() if len(T) else np.array([]) for n, T in variants.items()}
    for Y in years:
        best, best_v = None, -np.inf
        for name, T in variants.items():
            if not len(T):
                continue
            past = T[(yr_cache[name] >= first_year) & (yr_cache[name] < Y)]
            if not len(past):
                continue
            daily = past.groupby("day").net.sum()
            if metric == "mean":
                val = daily.mean()
            else:
                sd = daily.std(ddof=1)
                val = daily.mean() / sd if sd > 0 else -np.inf
            if val > best_v:
                best, best_v = name, val
        if best is None:
            continue
        T = variants[best]
        picked.append(T[yr_cache[best] == Y])
        choices.append({"year": Y, "variant": best})
    out = pd.concat(picked, ignore_index=True) if picked else _empty()
    return {"trades": out, "choices": choices, "stats": stats(out, book)}


def split_sealed(T: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    return T[T.day < SEAL_DAY], T[T.day >= SEAL_DAY]


def describe(stats_: dict) -> str:
    if not stats_.get("trades"):
        return "no trades"
    return (f"{stats_['per_month_pct'] * 100:.2f}%/month (median {stats_['median_month_pct'] * 100:.2f}%), "
            f"months+ {stats_['month_win_rate'] * 100:.0f}%, trades+ {stats_['trade_win_rate'] * 100:.0f}%, "
            f"maxDD {stats_['max_dd_pct'] * 100:.1f}%, worst month {stats_['worst_month_pct'] * 100:.1f}%, "
            f"Sharpe {stats_['sharpe']:.2f}, {stats_['net_bps_per_trade']:.1f} bps/trade net, {stats_['trades']} trades")


# ------------------------------------------------------------ checks
def max_exposure(T: pd.DataFrame) -> float:
    """Largest notional open at any bar of any session (positions hold from the
    close of their entry bar to the close of their exit bar)."""
    if T is None or len(T) == 0:
        return 0.0
    worst = 0.0
    for _d, g in T.groupby("day"):
        use = np.zeros(NB + 1)
        for eb, xb, nv in zip(g.entry_bar.to_numpy(dtype=int), g.exit_bar.to_numpy(dtype=int), g.notional.to_numpy()):
            use[eb:xb] += nv  # open after the close of bar eb, closed at the close of bar xb
        worst = max(worst, float(use.max()))
    return worst


def check(T: pd.DataFrame, lab: Lab, capital: float = BOOK) -> dict:
    """Contract checks for an experiment's trades: unlevered, sealed sessions untouched."""
    need = {"day", "symbol", "side", "qty", "entry", "exit", "entry_bar", "exit_bar", "gross", "costs", "net", "notional"}
    missing = need - set(T.columns)
    exp = max_exposure(T)
    sealed = int((T.day >= SEAL_DAY).sum()) if not lab.final else 0
    return {"missing_columns": sorted(missing), "max_exposure": exp, "unlevered": exp <= capital * 1.001,
            "sealed_trades": sealed, "ok": not missing and exp <= capital * 1.001 and sealed == 0}


def perturb(lab: Lab, day_from: int, day_to: int, after_bar: int, seed: int = 7) -> Lab:
    """A copy of the lab where, for sessions in [day_from, day_to), every bar
    AFTER `after_bar` is randomly rescaled (OHLC kept consistent). A strategy
    that decides by `after_bar` must make the same decisions on those sessions
    (and on every earlier session) as on the original data."""
    rng = np.random.default_rng(seed)
    m = (lab.df.day.to_numpy() >= day_from) & (lab.df.day.to_numpy() < day_to)
    o, h, l, c, v = (a.copy() for a in (lab.o, lab.h, lab.l, lab.c, lab.v))
    k = after_bar + 1
    n = int(m.sum())
    f = np.exp(np.cumsum(rng.normal(0, 0.004, (n, NB - k)), axis=1)).astype(np.float32)
    for a in (o, h, l, c):
        a[m, k:] = a[m, k:] * f
    v[m, k:] = v[m, k:] * rng.uniform(0.3, 3.0, (n, NB - k)).astype(np.float32)
    hi = np.maximum.reduce([o, h, l, c])
    lo = np.minimum.reduce([o, h, l, c])
    return Lab(lab.df, o, hi, lo, c, v, lab.year, lab.final)


def leak_test(run_fn, lab: Lab, days: list[str] | None = None, after_bar: int = 0, **kw) -> dict:
    """Lookahead test. For each sample session d, scramble that session's bars
    after `after_bar` and run the strategy again. Every decision (session,
    stock, side, entry bar <= after_bar) on d and on every session before d
    must be unchanged — later sessions may legitimately differ, since they
    may learn from d. Each sample costs one full run."""
    all_days = np.unique(lab.df.day.to_numpy())
    want = days or ["2024-09-18", "2025-06-10", "2025-11-14"]
    picks = []
    for w in want:
        x = (dt.date.fromisoformat(w) - dt.date(1970, 1, 1)).days
        k = int(np.searchsorted(all_days, x))
        if k < len(all_days):
            picks.append(int(all_days[k]))
    base = run_fn(lab, **kw)
    key = lambda T, d: set(map(tuple, T[(T.day <= d) & (T.entry_bar <= after_bar)][["day", "symbol", "side", "entry_bar"]].astype(str).to_numpy()))  # noqa: E731
    out = []
    for d in picks:
        alt = run_fn(perturb(lab, d, d + 1, after_bar), **kw)
        ka, kb = key(base, d), key(alt, d)
        out.append({"day": day_to_date(d).isoformat(), "decisions_compared": len(ka), "changed": len(ka ^ kb)})
    return {"after_bar": after_bar, "samples": out, "ok": all(o["changed"] == 0 for o in out)}
