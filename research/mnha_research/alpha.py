"""The stock-ranking model: each week, which liquid F&O stocks are likely to
beat the rest over the coming weeks?

Why this rather than more timing rules: the 100,000-strategy search found
almost no per-stock entry/exit rule that survived its untouched test period.
The approach with long, independent evidence in Indian equities is
cross-sectional — rank a liquid universe on price/volume traits (momentum,
trend, volatility, liquidity) and hold the top names. A model only earns its
keep here if, out of sample and after costs, it beats
  * NIFTYBEES, the index fund anyone can buy;
  * the equal-weight universe it chooses from — that universe carries the
    same survivorship bias as the picks, so beating it is the honest test of
    selection skill;
  * plain 12-1 momentum, the no-ML rule.

Protocol — expanding-window walk-forward, never shuffled:
  for each calendar year Y once MIN_TRAIN_YEARS of history exist:
    fit on decision dates whose label window had closed by Y's first decision
    predict every decision date in Y
Every portfolio decision therefore comes from a model that had not seen that
period. Hyperparameters are fixed in advance and not tuned on the results;
both pre-registered variants (weekly, 4-weekly) are always reported.

Execution: decide on the week's last close, trade at the NEXT session's
close (a closing-session order placed with a day to spare) with adverse
slippage, delivery costs from `costs` (effective-dated), equal slots of
book/TOP_K; a holding is kept while it ranks inside BUFFER so the book does
not churn on noise.

Data notes, measured on Groww's daily history (2003→):
  * opens and lows before ~2010 are unreliable (an open below the prior close
    by 15-20% day after day on quiet names), so features and fills use only
    closes and volumes;
  * the series is stitched on 2010-01-04 with a scale break on some names, and
    demergers are not adjusted. `adjust_actions` back-adjusts the stitch and a
    short list of verified demergers; other large moves are left alone because
    most are real (2008, YES Bank, March 2020, the 2024 election day).
"""

from __future__ import annotations

import datetime as dt
import json
import math
import time
from dataclasses import dataclass, field

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from . import config, db
from .costs import COST_MODEL_VERSION, trade_costs
from .series import load_frame
from .sessions import ist_day
from .validation import day_to_date

TOP_K = 10
BUFFER = 20  # a holding is kept while its rank stays inside this
LIQUID_N = 150  # eligible: the N most traded names by 60-day median ₹ value
MIN_HISTORY = 260  # bars a stock needs before it is eligible
MIN_NAMES = 30  # decision dates with fewer eligible names are skipped
MIN_TRAIN_YEARS = 4
VARIANTS = {"weekly": 1, "monthly": 4}  # label horizon and rebalance cadence, in weeks
BOOK = 1_000_000.0
EXEC_SLIPPAGE_BPS = 5.0  # adverse, per fill in the closing session
HGB = dict(max_iter=250, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=1000, l2_regularization=1.0)

STOCK_FEATURES = [
    "r5", "r20", "r60", "r120", "r250", "mom_12_1", "vol20", "vol60", "dd_high250", "up_low250",
    "dist_ema50", "dist_ema200", "rsi14", "atr_pct", "relvol", "liq", "max_ret20", "beta120", "age",
]
MARKET_FEATURES = ["m_r20", "m_r60", "m_trend", "m_vol20", "m_breadth", "m_disp"]
FEATURES = STOCK_FEATURES + MARKET_FEATURES


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------ corporate actions
def _day(iso: str) -> int:
    return (dt.date.fromisoformat(iso) - dt.date(1970, 1, 1)).days


STITCH_DAY = _day("2010-01-01")  # first session on/after this joins two differently-scaled histories
STITCH_TOLERANCE = 0.07  # |log gap| above this on the stitch session is a scale break, not a move
# Demergers Groww's adjustment leaves as a price drop (seen in the data, checked
# against the corporate action). Factor = first-session open / prior close.
KNOWN_ACTIONS = {
    ("RELIANCE", _day("2006-01-18")): "demerger of the Anil Ambani group companies",
    ("MFSL", _day("2016-01-27")): "demerger of Max India",
    ("CGPOWER", _day("2016-03-15")): "demerger of Crompton Greaves Consumer",
    ("NMDC", _day("2022-10-27")): "demerger of NMDC Steel",
    ("SIEMENS", _day("2025-04-07")): "demerger of Siemens Energy India",
    ("TMPV", _day("2025-10-14")): "demerger of Tata Motors' commercial vehicles",
    ("VEDL", _day("2026-04-30")): "Vedanta demerger",
}


def adjust_actions(symbol: str, days: np.ndarray, o, h, l, c, v) -> list[dict]:
    """Back-adjust, in place, the bars before each corporate action so the
    series has no artificial jump. Returns what was applied."""
    out = []
    if len(days) < 2:
        return out
    events = []
    st = int(np.searchsorted(days, STITCH_DAY))
    if 0 < st < len(days) and c[st - 1] > 0 and np.isfinite(c[st - 1]):
        g = o[st] / c[st - 1] if np.isfinite(o[st]) and o[st] > 0 else c[st] / c[st - 1]
        if abs(math.log(g)) > STITCH_TOLERANCE:
            events.append((st, g, "2010 stitch scale break"))
    for (sym, day), why in KNOWN_ACTIONS.items():
        if sym != symbol:
            continue
        i = int(np.searchsorted(days, day))
        if 0 < i < len(days) and days[i] == day and c[i - 1] > 0:
            g = o[i] / c[i - 1] if day >= STITCH_DAY and np.isfinite(o[i]) and o[i] > 0 else c[i] / c[i - 1]
            events.append((i, g, why))
    for i, g, why in events:
        for a in (o, h, l, c):
            a[:i] *= g
        v[:i] /= g
        out.append({"symbol": symbol, "day": (dt.date(1970, 1, 1) + dt.timedelta(days=int(days[i]))).isoformat(), "factor": float(g), "why": why})
    return out


# ------------------------------------------------------------ panel
@dataclass
class Panel:
    days: np.ndarray  # (D,) IST day numbers, ascending
    symbols: list[str]  # (S,)
    O: np.ndarray  # (D, S) NaN where the stock has no bar
    H: np.ndarray
    L: np.ndarray
    C: np.ndarray
    V: np.ndarray
    bench_o: np.ndarray  # (D,) benchmark open / close, NaN where missing
    bench_c: np.ndarray
    actions: list = field(default_factory=list)  # corporate-action adjustments applied


def panel_from_frames(frames: dict[str, pd.DataFrame], bench: pd.DataFrame | None) -> Panel:
    """Daily bars on one calendar. A day is a session if at least 30% of the
    names listed by then have a bar — stray single-symbol rows are dropped."""
    frames = {s: f for s, f in frames.items() if f is not None and len(f)}
    if not frames:
        raise RuntimeError("no daily data")
    syms = sorted(frames)
    per = {s: ist_day(frames[s]["time"].to_numpy(dtype=np.int64)) for s in syms}
    all_days = np.unique(np.concatenate(list(per.values())))
    count = np.zeros(len(all_days), dtype=np.int64)
    first = np.zeros(len(all_days), dtype=np.int64)
    for s in syms:
        count[np.searchsorted(all_days, per[s])] += 1
        first[np.searchsorted(all_days, per[s][0])] += 1
    listed = np.cumsum(first)
    days = all_days[count >= np.maximum(1, 0.3 * listed)]
    D, S = len(days), len(syms)
    arr = {k: np.full((D, S), np.nan) for k in ("open", "high", "low", "close", "volume")}
    actions: list[dict] = []

    def cols(f, d, name):
        keep = np.isin(d, days)
        o, h, l, c, v = (f[k].to_numpy(dtype=float)[keep].copy() for k in ("open", "high", "low", "close", "volume"))
        bad = ~np.isfinite(c) | (c <= 0)  # opens/lows before 2010 are unreliable, so only the close is checked
        for a in (o, h, l, c, v):
            a[bad] = np.nan
        good = ~bad
        dd = d[keep]
        parts = [a[good] for a in (o, h, l, c, v)]
        actions.extend(adjust_actions(name, dd[good], *parts))
        for a, part in zip((o, h, l, c, v), parts):
            a[good] = part
        return np.searchsorted(days, dd), o, h, l, c, v

    for j, s in enumerate(syms):
        idx, *vals = cols(frames[s], per[s], s)
        for k, a in zip(("open", "high", "low", "close", "volume"), vals):
            arr[k][idx, j] = a
    bo, bc = np.full(D, np.nan), np.full(D, np.nan)
    if bench is not None and len(bench):
        idx, o, _h, _l, c, _v = cols(bench, ist_day(bench["time"].to_numpy(dtype=np.int64)), config.BENCHMARK)
        bo[idx], bc[idx] = o, c
    return Panel(days, syms, arr["open"], arr["high"], arr["low"], arr["close"], arr["volume"], bo, bc, actions)


def load_panel(symbols: list[str]) -> Panel:
    return panel_from_frames({s: load_frame(s, 1440) for s in symbols}, load_frame(config.BENCHMARK, 1440))


def load_design() -> tuple[Design, dict]:
    """Current and former F&O stocks, eligible only while they had F&O."""
    from . import ingest, pit

    p = load_panel(ingest.stocks())
    snaps = pit.snapshots()
    member = pit.mask(p.days, p.symbols, snaps)
    info = {"pit_snapshots": len(snaps), "pit_first": day_to_date(snaps[0][0]).isoformat() if snaps else None,
            "coverage_by_year": pit.coverage(p.days, p.symbols, np.isfinite(p.C), snaps)}
    return design(p, member), info


# ------------------------------------------------------------ features
@dataclass
class Design:
    p: Panel
    ranked: dict[str, np.ndarray]  # stock features, cross-sectional percentile among eligible (D, S)
    market: dict[str, np.ndarray]  # market features (D,)
    raw_mom: np.ndarray  # 12-1 momentum, for the no-ML baseline (D, S)
    elig: np.ndarray  # (D, S) bool
    mark: np.ndarray  # (D, S) close carried forward, for marking positions
    R: np.ndarray  # decision rows: the last session of each week that has a next session
    E: np.ndarray  # execution rows: R + 1
    px: np.ndarray  # (D, S) execution price: that session's close


def design(p: Panel, member: np.ndarray | None = None) -> Design:
    """Every value at row d uses bars at or before d only. `member` (D, S):
    the stock had F&O on that day (pit.mask); None = no restriction."""
    C = pd.DataFrame(p.C)
    Cf = C.ffill(limit=5)
    V = pd.DataFrame(p.V)
    bf = pd.Series(p.bench_c).ffill(limit=5)
    f: dict[str, pd.DataFrame] = {}
    with np.errstate(divide="ignore", invalid="ignore"):
        for k in (5, 20, 60, 120, 250):
            f[f"r{k}"] = Cf / Cf.shift(k) - 1
        f["mom_12_1"] = Cf.shift(20) / Cf.shift(250) - 1
        lr = np.log(Cf / Cf.shift(1))
        f["vol20"] = lr.rolling(20, min_periods=15).std()
        f["vol60"] = lr.rolling(60, min_periods=45).std()
        f["dd_high250"] = Cf / Cf.rolling(250, min_periods=200).max() - 1
        f["up_low250"] = Cf / Cf.rolling(250, min_periods=200).min() - 1
        f["dist_ema50"] = Cf / Cf.ewm(span=50, adjust=False, min_periods=50).mean() - 1
        f["dist_ema200"] = Cf / Cf.ewm(span=200, adjust=False, min_periods=200).mean() - 1
        dc = Cf.diff()
        au = dc.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
        ad = (-dc).clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
        f["rsi14"] = 100 - 100 / (1 + au / ad)
        pc = Cf.shift(1)
        f["atr_pct"] = lr.abs().ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()  # close-to-close: H/L are unreliable early
        f["relvol"] = V.rolling(5, min_periods=3).mean() / V.rolling(60, min_periods=40).mean()
        f["liq"] = np.log((C * V).rolling(60, min_periods=40).median())
        f["max_ret20"] = (Cf / pc - 1).rolling(20, min_periods=15).max()
        rb = np.log(bf / bf.shift(1))
        mx = lr.rolling(120, min_periods=90).mean()
        my = rb.rolling(120, min_periods=90).mean()
        mxy = lr.mul(rb, axis=0).rolling(120, min_periods=90).mean()
        vy = rb.rolling(120, min_periods=90).var(ddof=0)
        f["beta120"] = (mxy - mx.mul(my, axis=0)).div(vy, axis=0)
        listed = C.notna().cumsum()
        f["age"] = np.log(listed.where(listed > 0))
    for k in f:
        f[k] = f[k].replace([np.inf, -np.inf], np.nan)

    cand = (listed >= MIN_HISTORY) & C.notna() & (V > 0) & f["liq"].notna()
    if member is not None:
        cand &= member
    liq_rank = f["liq"].where(cand).rank(axis=1, ascending=False, method="first")
    elig = (liq_rank <= LIQUID_N).to_numpy()
    ranked = {k: f[k].where(elig).rank(axis=1, pct=True).to_numpy(dtype=np.float32) for k in STOCK_FEATURES}

    with np.errstate(divide="ignore", invalid="ignore"):
        ema200 = bf.ewm(span=200, adjust=False, min_periods=200).mean()
        market = {
            "m_r20": (bf / bf.shift(20) - 1).to_numpy(),
            "m_r60": (bf / bf.shift(60) - 1).to_numpy(),
            "m_trend": np.where(ema200.isna(), np.nan, (bf > ema200).astype(float)),
            "m_vol20": (np.log(bf / bf.shift(1)).rolling(20, min_periods=15).std() * math.sqrt(252)).to_numpy(),
            "m_breadth": (f["dist_ema200"] > 0).astype(float).where(elig).mean(axis=1).to_numpy(),
            "m_disp": f["r20"].where(elig).std(axis=1).to_numpy(),
        }
    week = (p.days + 3) // 7  # Monday-based week number (day 0 = Thursday 1970-01-01)
    last = np.zeros(len(p.days), dtype=bool)
    last[:-1] = week[1:] != week[:-1]  # the final row has no next session to trade in
    R = np.nonzero(last)[0]
    return Design(p, ranked, market, f["mom_12_1"].where(elig).to_numpy(), elig,
                  pd.DataFrame(p.C).ffill().to_numpy(), R, R + 1, p.C)


def matrix(des: Design, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Feature matrix for the eligible names at each decision row.
    Returns (X, position in `rows`, symbol index)."""
    e = des.elig[rows]
    ii, jj = np.nonzero(e)
    X = np.empty((len(ii), len(FEATURES)), dtype=np.float32)
    rr = rows[ii]
    for c, k in enumerate(STOCK_FEATURES):
        X[:, c] = des.ranked[k][rr, jj]
    for c, k in enumerate(MARKET_FEATURES, start=len(STOCK_FEATURES)):
        X[:, c] = des.market[k][rr]
    return X, ii, jj


def labels(des: Design, h: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Forward return from the decision's execution close to the execution
    close `h` weeks later, its cross-sectional percentile among eligible
    names, and the row at which it becomes known (the exit session)."""
    O = des.px
    n = len(des.R)
    raw = np.full((n, O.shape[1]), np.nan)
    known = np.full(n, np.iinfo(np.int64).max, dtype=np.int64)
    if n > h:
        with np.errstate(divide="ignore", invalid="ignore"):
            raw[: n - h] = O[des.E[h:]] / O[des.E[: n - h]] - 1
        known[: n - h] = des.E[h:]
    raw = np.where(des.elig[des.R], raw, np.nan)
    pct = pd.DataFrame(raw).rank(axis=1, pct=True).to_numpy()
    return raw, pct, known


def _model(seed: int) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(**HGB, early_stopping=False, random_state=seed)


def fold_plan(des: Design, h: int, known: np.ndarray) -> list[tuple[int, np.ndarray, np.ndarray]]:
    """(year, training decision indices, test decision indices). A training
    row's label must be known (its exit session closed) by the close of the
    year's first decision — the embargo that keeps labels out of the test."""
    n_names = des.elig[des.R].sum(axis=1)
    ok = n_names >= MIN_NAMES
    if not ok.any():
        raise RuntimeError("no decision date has enough eligible names")
    years = np.array([day_to_date(int(d)).year for d in des.p.days[des.R]])
    first_year = int(years[ok][0])
    plan = []
    for Y in range(first_year + MIN_TRAIN_YEARS, int(years[-1]) + 1):
        test = np.nonzero(ok & (years == Y))[0]
        if len(test):
            plan.append((Y, np.nonzero(ok & (known <= des.R[test[0]]))[0], test))
    return plan


def walk_forward(des: Design, h: int, seed: int = config.SEED) -> dict:
    """Out-of-sample scores for every decision date from the first test year."""
    raw, pct, known = labels(des, h)
    pred = np.full(raw.shape, np.nan, dtype=np.float32)
    folds = []
    for Y, train, test in fold_plan(des, h, known):
        X, ii, jj = matrix(des, des.R[train])
        y = pct[train[ii], jj]
        m = np.isfinite(y)
        if m.sum() < 2000:
            continue
        model = _model(seed).fit(X[m], y[m])
        Xt, it, jt = matrix(des, des.R[test])
        pred[test[it], jt] = model.predict(Xt)
        folds.append({"year": Y, "train_rows": int(m.sum()), "train_until": day_to_date(int(des.p.days[des.R[test[0]]])).isoformat(),
                      "test_dates": int(len(test))})
    return {"pred": pred, "raw": raw, "pct": pct, "folds": folds}


# ------------------------------------------------------------ portfolio
def simulate(des: Design, events: list[tuple[int, np.ndarray]], k: int = TOP_K, buffer: int = BUFFER,
             cost_mult: float = 1.0, slippage_bps: float = EXEC_SLIPPAGE_BPS, book: float = BOOK) -> dict:
    """events: (execution row, score per symbol; NaN = not eligible). At each
    event: sell holdings ranked outside `buffer`, then fill empty slots from
    the top at equity/k each. Round-trip costs are charged when a position
    closes; anything still open is closed at the last close."""
    p = des.p
    O, M = des.px, des.mark
    slip = slippage_bps / 1e4
    cash = book
    pos: dict[int, list] = {}  # symbol -> [qty, entry price, entry day, entry row]
    closed = []
    equity = np.full(len(p.days), np.nan)
    if not events:
        return {"equity": equity, "trades": [], "start_row": None}
    start = events[0][0]
    ev = iter(events)
    nxt = next(ev, None)
    bought = 0.0

    def close(j, row, px, why):
        nonlocal cash
        qty, epx, eday, erow = pos.pop(j)
        cost = float(trade_costs(np.array([qty * epx]), np.array([qty * px]), np.array([1]), np.array([eday]), False)[0]) * cost_mult
        cash += qty * px - cost
        closed.append({"symbol": p.symbols[j], "entry_day": int(eday), "exit_day": int(p.days[row]), "qty": qty,
                       "entry": epx, "exit": px, "cost": cost, "net": qty * (px - epx) - cost, "why": why})

    for row in range(start, len(p.days)):
        while nxt is not None and nxt[0] == row:
            sc = np.where(np.isfinite(nxt[1]), nxt[1], -np.inf)
            n_ok = int(np.isfinite(nxt[1]).sum())
            order = np.argsort(-sc, kind="stable")[:n_ok]
            rank = np.full(len(sc), np.inf)
            rank[order] = np.arange(n_ok)
            for j in [j for j in pos if rank[j] >= buffer]:
                if np.isfinite(O[row, j]):
                    close(j, row, O[row, j] * (1 - slip), "rebalance")
            held = sum(q * (O[row, j] if np.isfinite(O[row, j]) else M[row - 1, j]) for j, (q, *_rest) in pos.items())
            slot = (cash + held) / k
            for j in order:
                if len(pos) >= k:
                    break
                if j in pos or not np.isfinite(O[row, j]) or O[row, j] <= 0:
                    continue
                px = O[row, j] * (1 + slip)
                qty = int(min(slot, cash) // px)
                if qty <= 0:
                    continue
                cash -= qty * px
                bought += qty * px
                pos[j] = [qty, px, int(p.days[row]), row]
            nxt = next(ev, None)
        equity[row] = cash + sum(q * M[row, j] for j, (q, *_rest) in pos.items())
    last = len(p.days) - 1
    open_positions = [{"symbol": p.symbols[j], "qty": q, "entry": e, "entry_day": int(d), "mark": float(M[last, j])}
                      for j, (q, e, d, _r) in pos.items()]
    for j in list(pos):
        close(j, last, M[last, j] * (1 - slip), "end")
    equity[last] = cash
    years = max((p.days[last] - p.days[start]) / 365.25, 1 / 365.25)
    return {"equity": equity, "trades": closed, "open": open_positions, "start_row": start,
            "turnover_per_year": bought / max(np.nanmean(equity[start:]), 1.0) / years,
            "costs": float(sum(t["cost"] for t in closed))}


def perf(points_day: np.ndarray, value: np.ndarray, per_year: int = 52) -> dict:
    """Return statistics from a value series sampled at decision dates."""
    v = np.asarray(value, dtype=float)
    m = np.isfinite(v) & (v > 0)
    d, v = points_day[m], v[m]
    if len(v) < 3:
        return {}
    r = v[1:] / v[:-1] - 1
    yrs = max((d[-1] - d[0]) / 365.25, 1 / 365.25)
    sd = r.std(ddof=1)
    by_year: dict[str, float] = {}
    years = np.array([day_to_date(int(x)).year for x in d])
    prev = v[0]
    for y in np.unique(years):
        endv = v[years == y][-1]
        by_year[str(int(y))] = float(endv / prev - 1)
        prev = endv
    return {
        "start": day_to_date(int(d[0])).isoformat(), "end": day_to_date(int(d[-1])).isoformat(),
        "total": float(v[-1] / v[0] - 1), "cagr": float((v[-1] / v[0]) ** (1 / yrs) - 1),
        "vol": float(sd * math.sqrt(per_year)), "sharpe": float(r.mean() / sd * math.sqrt(per_year)) if sd > 0 else None,
        "max_dd": float(np.max(1 - v / np.maximum.accumulate(v))), "by_year": by_year,
    }


def _ew_points(des: Design, idx: np.ndarray) -> np.ndarray:
    """Equal weight over all eligible names, rebalanced weekly, no costs — a
    frictionless stand-in for 'own the whole universe'."""
    O = des.px
    vals = [1.0]
    for a, b in zip(idx[:-1], idx[1:]):
        e0, e1 = des.E[a], des.E[b]
        with np.errstate(divide="ignore", invalid="ignore"):
            r = O[e1] / O[e0] - 1
        r = r[des.elig[des.R[a]] & np.isfinite(r)]
        vals.append(vals[-1] * (1 + (r.mean() if len(r) else 0.0)))
    return np.array(vals)


def information(pred: np.ndarray, raw: np.ndarray, idx: np.ndarray, step: int) -> dict:
    """Rank correlation between the scores and what followed, on
    non-overlapping decision dates."""
    ics, spreads = [], []
    for i in idx[::step]:
        m = np.isfinite(pred[i]) & np.isfinite(raw[i])
        if m.sum() < MIN_NAMES:
            continue
        a = pd.Series(pred[i][m]).rank().to_numpy()
        b = pd.Series(raw[i][m]).rank().to_numpy()
        ics.append(float(np.corrcoef(a, b)[0, 1]))
        q = max(1, m.sum() // 10)
        order = np.argsort(-pred[i][m])
        spreads.append(float(raw[i][m][order[:q]].mean() - raw[i][m][order[-q:]].mean()))
    ics = np.array(ics)
    if not len(ics):
        return {}
    return {"dates": int(len(ics)), "ic_mean": float(ics.mean()), "ic_t": float(ics.mean() / ics.std(ddof=1) * math.sqrt(len(ics))) if len(ics) > 2 else None,
            "ic_positive": float((ics > 0).mean()), "top_minus_bottom_decile": float(np.mean(spreads))}


def evaluate(des: Design, wf: dict, h: int) -> dict:
    pred, raw = wf["pred"], wf["raw"]
    has = np.nonzero(np.isfinite(pred).any(axis=1))[0]
    if len(has) < 10:
        return {"error": "too few out-of-sample dates"}
    idx = np.arange(has[0], len(des.R))  # weekly marking points from the first OOS decision
    reb = has[::h]
    events = [(int(des.E[i]), pred[i]) for i in reb]
    model = simulate(des, events)
    model2 = simulate(des, events, cost_mult=2.0)
    mom = simulate(des, [(int(des.E[i]), des.raw_mom[des.R[i]]) for i in reb])
    days = des.p.days[des.R[idx]]

    def pts(sim):
        eq = sim["equity"][des.R[idx]].copy()
        eq[0] = BOOK
        return eq

    bench = pd.Series(des.p.bench_c).ffill().to_numpy()[des.R[idx]]
    ew = _ew_points(des, idx)
    series = {"model": pts(model), "model_cost_x2": pts(model2), "momentum_12_1": pts(mom), "equal_weight_universe": ew, "niftybees": bench}
    out = {name: perf(days, v) for name, v in series.items()}
    # weekly excess return of the model over each benchmark
    rm = series["model"][1:] / series["model"][:-1] - 1
    for name in ("equal_weight_universe", "niftybees", "momentum_12_1"):
        rb = series[name][1:] / series[name][:-1] - 1
        x = (rm - rb)[np.isfinite(rm - rb)]
        out[f"excess_vs_{name}"] = {"weekly_mean": float(x.mean()), "t": float(x.mean() / x.std(ddof=1) * math.sqrt(len(x))) if len(x) > 2 else None,
                                     "weeks_ahead": float((x > 0).mean())}
    recent = days >= (np.datetime64("2024-01-01").astype(np.int64))
    out["since_2024"] = {name: perf(days[recent], v[recent]) for name, v in series.items()}
    out["information"] = information(pred, raw, has, h)
    out["trading"] = {"trades": len(model["trades"]), "turnover_per_year": model["turnover_per_year"], "costs": model["costs"],
                      "win_rate": float(np.mean([t["net"] > 0 for t in model["trades"]])) if model["trades"] else None}
    out["folds"] = wf["folds"]
    return out


def current_picks(model, des: Design, row: int | None = None, n: int = BUFFER) -> list[dict]:
    row = len(des.p.days) - 1 if row is None else row
    X, _ii, jj = matrix(des, np.array([row]))
    if not len(jj):
        return []
    s = model.predict(X)
    order = np.argsort(-s, kind="stable")[:n]
    return [{"rank": r + 1, "symbol": des.p.symbols[jj[o]], "score": float(s[o]), "close": float(des.p.C[row, jj[o]])}
            for r, o in enumerate(order)]


def fit_final(des: Design, h: int, seed: int = config.SEED):
    """One model on every label known at the last decision date."""
    raw, pct, known = labels(des, h)
    ok = des.elig[des.R].sum(axis=1) >= MIN_NAMES
    train = np.nonzero(ok & (known <= len(des.p.days) - 1))[0]
    X, ii, jj = matrix(des, des.R[train])
    y = pct[train[ii], jj]
    m = np.isfinite(y)
    return _model(seed).fit(X[m], y[m]), int(m.sum())


# ------------------------------------------------------------ run
def run(data_version: str | None = None) -> dict:
    params = {"top_k": TOP_K, "buffer": BUFFER, "liquid_n": LIQUID_N, "min_history": MIN_HISTORY, "min_train_years": MIN_TRAIN_YEARS,
              "variants": VARIANTS, "hgb": HGB, "features": FEATURES, "benchmark": config.BENCHMARK, "slippage_bps": EXEC_SLIPPAGE_BPS,
              "execution": "next session close", "universe": "point-in-time F&O members (current + former, still listed)", "known_actions": len(KNOWN_ACTIONS), "stitch_tolerance": STITCH_TOLERANCE,
              "cost_model": COST_MODEL_VERSION, "book": BOOK}
    rid = db.start_run("alpha", params, data_version, config.SEED)
    try:
        t0 = time.time()
        des, pit_info = load_design()
        p = des.p
        log(f"alpha: panel {len(p.days)} sessions x {len(p.symbols)} names, {day_to_date(int(p.days[0]))} .. {day_to_date(int(p.days[-1]))}")
        summary: dict = {"panel": {"sessions": int(len(p.days)), "names": len(p.symbols), "from": day_to_date(int(p.days[0])).isoformat(),
                                   "to": day_to_date(int(p.days[-1])).isoformat(), "corporate_actions_adjusted": p.actions, **pit_info},
                     "variants": {}}
        config.MODELS.mkdir(parents=True, exist_ok=True)
        for name, h in VARIANTS.items():
            wf = walk_forward(des, h)
            res = evaluate(des, wf, h)
            model, rows = fit_final(des, h)
            picks = current_picks(model, des)
            artifact = config.MODELS / f"alpha_{name}_run{rid}.joblib"
            joblib.dump({"model": model, "features": FEATURES, "variant": name, "h": h, "trained_rows": rows,
                         "trained_through": day_to_date(int(p.days[-1])).isoformat(), "params": params}, artifact)
            with db.tx() as con:
                con.execute(
                    "INSERT INTO ml_models(run_id, created_at, kind, features, params, metrics, artifact) VALUES(?,?,?,?,?,?,?)",
                    (rid, time.time(), f"alpha_{name}", json.dumps(FEATURES), json.dumps(params, default=str),
                     json.dumps({**res, "picks": picks}, default=str), str(artifact)),
                )
            summary["variants"][name] = {**res, "picks_asof": day_to_date(int(p.days[-1])).isoformat(), "picks": picks[:TOP_K], "artifact": str(artifact)}
            m, n_, e = res.get("model", {}), res.get("niftybees", {}), res.get("equal_weight_universe", {})
            log(f"alpha {name}: model CAGR {m.get('cagr', float('nan')):.1%} DD {m.get('max_dd', float('nan')):.1%} | "
                f"EW {e.get('cagr', float('nan')):.1%} | NIFTYBEES {n_.get('cagr', float('nan')):.1%} | IC {res.get('information', {}).get('ic_mean')}")
        summary["seconds"] = round(time.time() - t0)
        db.finish_run(rid, "done", summary)
        summary["run_id"] = rid
        return summary
    except Exception as e:
        db.finish_run(rid, "failed", error=repr(e)[:2000])
        raise
