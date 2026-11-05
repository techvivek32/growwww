"""Refining the 09:20 short rule without fooling ourselves.

The candidate (daytrade stage 2, `s2_short3`): every session at 09:20 short
the three stocks the model ranks lowest, cover at 15:15. Variants change the
execution only — entry time, exit time, how many names, a stop, a target —
on the SAME out-of-sample model scores.

Choosing the best variant on the whole history and reporting it would be
the overfitting the sealed holdout was there to stop (and the holdout has
now been looked at once). So the headline is a walk-forward SELECTION: for
each year Y, the variant with the best Sharpe on the years before Y is the
one traded in Y. That is what refining as you go would actually have earned.
The full grid is reported too, labelled as in-sample.

Fills, per 5-minute bar after entry (short side):
  * entry at the close of the bar ending at the entry time, adverse slippage;
  * a stop above entry: hit when the bar's high reaches it; filled at the
    stop, or at the bar's open if it opened beyond, plus slippage;
  * a target below entry: a resting limit, filled at the target (or a
    better open) without slippage;
  * stop and target in the same bar count as the stop;
  * otherwise covered at the close of the bar ending at the exit time.
Costs: intraday schedule per trade.
"""

from __future__ import annotations

import datetime as dt
import itertools
import json
import math
import time

import numpy as np
import pandas as pd
from numba import njit

from . import config, daytrade as dtm, db, quality
from .costs import trade_costs
from .series import load_frame
from .sessions import ist_day, ist_minute
from .validation import day_to_date

MAX_K = 6
ENTRY = [9 * 60 + 20, 9 * 60 + 25, 9 * 60 + 30]  # minute the entry bar ends
EXIT = [11 * 60 + 30, 13 * 60, 14 * 60, 15 * 60 + 15]  # minute the exit bar ends
KS = [1, 2, 3, 4, 5]
STOPS = [0.0, 0.01, 0.02, 0.03]  # fraction above entry; 0 = none
TARGETS = [0.0, 0.01, 0.02, 0.03]  # fraction below entry; 0 = none
SLIP = dtm.EXIT_SLIP_BPS / 1e4
BOOK = dtm.BOOK
BASE = {"entry": 9 * 60 + 20, "exit": 15 * 60 + 15, "k": 3, "stop": 0.0, "target": 0.0}


@njit(cache=True)
def _walk(m, o, h, l, c, entry_end, exit_end, stop, target, slip):
    """One short position over one session's 5-minute bars (bar open minutes `m`).
    Returns (entry px, exit px, reason 0=time 1=stop 2=target); nan if no entry."""
    n = len(m)
    ei = -1
    for i in range(n):
        if m[i] + 5 == entry_end:
            ei = i
            break
    if ei < 0:
        return np.nan, np.nan, -1
    e = c[ei] * (1.0 - slip)
    sp = e * (1.0 + stop) if stop > 0 else np.inf
    tp = e * (1.0 - target) if target > 0 else -np.inf
    for i in range(ei + 1, n):
        if o[i] >= sp:
            return e, o[i] * (1.0 + slip), 1
        if o[i] <= tp:
            return e, o[i], 2
        if h[i] >= sp:
            return e, sp * (1.0 + slip), 1
        if l[i] <= tp:
            return e, tp, 2
        if m[i] + 5 >= exit_end:
            return e, c[i] * (1.0 + slip), 0
    return e, c[n - 1] * (1.0 + slip), 0


def candidates(final: bool = True) -> pd.DataFrame:
    """The MAX_K lowest stage-2 scores of every session, with that session's
    5-minute bars attached."""
    d = dtm.load()
    des = dtm.design(d)
    pred2 = np.load(config.DATA / f"daytrade_pred2_{'final' if final else 'dev'}.npy")
    p = d["p"]
    rows = []
    for t in np.nonzero(np.isfinite(pred2).any(axis=1))[0]:
        ok = np.nonzero(np.isfinite(pred2[t]))[0]
        if len(ok) < dtm.MIN_NAMES:
            continue
        order = ok[np.argsort(pred2[t, ok], kind="stable")][:MAX_K]
        for rank, j in enumerate(order, start=1):
            rows.append((int(p.days[t]), p.symbols[j], rank, float(pred2[t, j])))
    C = pd.DataFrame(rows, columns=["day", "symbol", "rank", "score"])
    bars = {}
    for sym, g in C.groupby("symbol"):
        x = load_frame(sym, 5)
        if x is None or x.empty:
            continue
        x, _s, _ = quality.reconcile(x, load_frame(sym, 1440))
        xd = ist_day(x["time"].to_numpy(dtype=np.int64))
        xm = ist_minute(x["time"].to_numpy(dtype=np.int64))
        want = set(g.day)
        for day in want:
            b = np.nonzero(xd == day)[0]
            if len(b):
                bars[(sym, day)] = (xm[b], *(x[k].to_numpy(dtype=np.float64)[b] for k in ("open", "high", "low", "close")))
    C["bars"] = [bars.get((s, d_)) for s, d_ in zip(C.symbol, C.day)]
    return C[C.bars.notna()].reset_index(drop=True)


def outcomes(C: pd.DataFrame) -> pd.DataFrame:
    """Every candidate under every (entry, exit, stop, target): ₹ net on its slot."""
    out = []
    for en, ex, sp, tg in itertools.product(ENTRY, EXIT, STOPS, TARGETS):
        if ex <= en:
            continue
        res = np.array([_walk(*b, en, ex, sp, tg, SLIP) for b in C.bars])
        out.append(pd.DataFrame({"i": np.arange(len(C)), "entry_m": en, "exit_m": ex, "stop": sp, "target": tg,
                                 "e": res[:, 0], "x": res[:, 1], "why": res[:, 2].astype(int)}))
    O = pd.concat(out, ignore_index=True)
    O = O[np.isfinite(O.e)]
    O["day"] = C.day.to_numpy()[O.i]
    O["rank"] = C["rank"].to_numpy()[O.i]
    return O


def evaluate(O: pd.DataFrame, k: int) -> pd.DataFrame:
    """₹ per trade for slot size BOOK/k, shorts only."""
    T = O[O["rank"] <= k].copy()
    slot = BOOK / k
    T["qty"] = np.floor(slot / T.e)
    T = T[T.qty > 0]
    ev, xv = T.qty * T.e, T.qty * T.x
    T["net"] = (T.e - T.x) * T.qty - trade_costs(ev.to_numpy(), xv.to_numpy(), -np.ones(len(T)), T.day.to_numpy(), True)
    T["k"] = k
    return T


def stats(T: pd.DataFrame) -> dict:
    if T.empty:
        return {"trades": 0}
    daily = T.groupby("day").net.sum()
    eq = BOOK + daily.cumsum()
    peak = np.maximum.accumulate(np.concatenate([[BOOK], eq.to_numpy()]))[1:]
    months = T.groupby(pd.to_datetime(T.day, unit="D").dt.to_period("M")).net.sum()
    years = max((T.day.max() - T.day.min()) / 365.25, 1 / 365.25)
    sd = daily.std(ddof=1)
    return {
        "trades": int(len(T)), "win_rate": float((T.net > 0).mean()), "days": int(len(daily)),
        "day_win_rate": float((daily > 0).mean()), "month_win_rate": float((months > 0).mean()),
        "net": float(T.net.sum()), "per_month_avg_pct": float(months.mean() / BOOK),
        "per_year_pct": float(T.net.sum() / years / BOOK), "max_dd_pct": float(np.max((peak - eq.to_numpy()) / peak)),
        "sharpe": float(daily.mean() / sd * math.sqrt(252)) if sd > 0 else None,
        "worst_month_pct": float(months.min() / BOOK), "best_month_pct": float(months.max() / BOOK),
    }


def run(final: bool = True) -> dict:
    t0 = time.time()
    C = candidates(final)
    O = outcomes(C)
    year = pd.to_datetime(O.day, unit="D").dt.year
    O["year"] = year.to_numpy()
    allT = pd.concat([evaluate(O, k) for k in KS], ignore_index=True)
    key = ["entry_m", "exit_m", "stop", "target", "k"]
    # in-sample grid (every variant over every year) — for transparency only
    grid = []
    for v, g in allT.groupby(key):
        s = stats(g)
        grid.append({**dict(zip(key, v)), **{k_: s[k_] for k_ in ("trades", "win_rate", "per_year_pct", "max_dd_pct", "sharpe", "month_win_rate")}})
    grid = pd.DataFrame(grid).sort_values("sharpe", ascending=False)
    # walk-forward selection: year Y trades the variant with the best Sharpe on years < Y
    years = sorted(allT.year.unique())
    picked, chosen = [], []
    for Y in years[1:]:
        past = allT[allT.year < Y]
        best, best_s = None, -np.inf
        for v, g in past.groupby(key):
            daily = g.groupby("day").net.sum()
            sd = daily.std(ddof=1)
            s = daily.mean() / sd if sd > 0 else -np.inf
            if s > best_s:
                best, best_s = v, s
        sel = allT[(allT.year == Y)]
        for k_, val in zip(key, best):
            sel = sel[sel[k_] == val]
        picked.append(sel)
        chosen.append({"year": int(Y), **{k_: (float(v_) if isinstance(v_, float) else int(v_)) for k_, v_ in zip(key, best)},
                       "net": float(sel.net.sum())})
    wf = pd.concat(picked, ignore_index=True)
    base = allT
    for k_, val in BASE.items():
        base = base[base[{"entry": "entry_m", "exit": "exit_m"}.get(k_, k_)] == val]
    base = base[base.year >= years[1]]
    months = wf.groupby(pd.to_datetime(wf.day, unit="D").dt.to_period("M")).net.sum()
    out = {
        "from": day_to_date(int(allT.day.min())).isoformat(), "to": day_to_date(int(allT.day.max())).isoformat(),
        "variants": int(len(grid)), "walk_forward_choices": chosen,
        "walk_forward": stats(wf), "base_same_years": stats(base),
        "walk_forward_monthly": {str(k_): round(float(v_)) for k_, v_ in months.items()},
        "top_in_sample": grid.head(15).to_dict("records"),
        "highest_win_rate_in_sample": grid.sort_values("win_rate", ascending=False).head(5).to_dict("records"),
        "elapsed_s": round(time.time() - t0),
    }
    with db.tx() as con:
        con.execute("INSERT INTO runs(kind, status, started_at, finished_at, params, seed, summary) VALUES(?,?,?,?,?,?,?)",
                    ("daytrade_refine", "done", t0, time.time(), json.dumps({"entry": ENTRY, "exit": EXIT, "k": KS, "stops": STOPS,
                                                                            "targets": TARGETS}), config.SEED, json.dumps(out, default=str)))
    return out
