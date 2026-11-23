"""SCALPING research program — separate from the intraday short rule (books A and B), which it never touches.

A scalping strategy here is a short-hold rule on 5-minute bars (we have no tick data, so "scalp" means a hold of
5–60 minutes), applied to one universe of stocks, one position at a time, with the whole book (₹5 lakh) per trade:

  signal      what fires the entry at the close of a bar (see SIGNALS): a breakout of the last-n-bar high/low, a
              VWAP cross, a momentum burst or reversal measured against the stock's own 5-minute ATR, each long or short
  universe    the most liquid 100 / 200 / 500 names by trailing turnover (the 500-stock panel)
  window      bars in which an entry may be taken (e.g. 09:25–11:00, 11:00–14:00, 09:25–15:00)
  stop/target as fractions of the entry price; a stop and a target in the same bar count as the stop
  max_hold    bars after which the trade is closed at the close; every trade is flat by 15:15
  per_day     maximum trades per day

Fills are conservative: entry at the signal bar's close plus slippage of max(3 bps, half a tick), stop at the stop
price (or the worse open), target at the target price, Groww intraday costs on every round trip. Those costs are
the reason most scalps lose: a 0.2% move keeps about 0.08% after charges.

Honesty rule: 1,00,000 random strategies are drawn; the 100 "best" are chosen on the SELECTION window only
(2024-01 .. 2026-04) and then reported on the later months (2026-05 .. today) that played no part in the choice.
"""

from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
from numba import njit, prange

from . import config, lab
from .validation import day_to_date

NB = lab.NB
BOOK = 500_000.0
TICK_DAY = 19884
EXCH_DAY = 19997
SEL_FROM = (dt.date(2024, 1, 1) - dt.date(1970, 1, 1)).days
SEL_TO = (dt.date(2026, 5, 1) - dt.date(1970, 1, 1)).days  # selection window end (exclusive); later months are the test

# ------------------------------------------------------------ the strategy space
SIGNALS = []  # (name, kind, param, side)
for n in (3, 6, 12):
    SIGNALS.append((f"break_high_{n}", "break_high", n, 1))
    SIGNALS.append((f"break_high_{n}_fade", "break_high", n, -1))
    SIGNALS.append((f"break_low_{n}", "break_low", n, -1))
    SIGNALS.append((f"break_low_{n}_fade", "break_low", n, 1))
SIGNALS += [("vwap_cross_up", "vwap_up", 0, 1), ("vwap_cross_up_fade", "vwap_up", 0, -1),
            ("vwap_cross_down", "vwap_down", 0, -1), ("vwap_cross_down_fade", "vwap_down", 0, 1)]
for k in (1.5, 2.5):
    SIGNALS.append((f"burst_up_{k}", "burst_up", k, 1))
    SIGNALS.append((f"burst_up_{k}_fade", "burst_up", k, -1))
    SIGNALS.append((f"burst_down_{k}", "burst_down", k, -1))
    SIGNALS.append((f"burst_down_{k}_fade", "burst_down", k, 1))
UNIVERSES = (100, 200, 500)
WINDOWS = ((2, 21), (2, 44), (9, 44), (21, 56), (9, 68), (2, 68))  # (first bar, last bar) an entry may be taken
STOPS = (0.002, 0.003, 0.005, 0.0075, 0.01)
TARGETS = (0.002, 0.003, 0.005, 0.0075, 0.01, 0.015)
HOLDS = (1, 2, 3, 6, 12)
PER_DAY = (1, 2, 3, 5)
SPACE = (len(SIGNALS), len(UNIVERSES), len(WINDOWS), len(STOPS), len(TARGETS), len(HOLDS), len(PER_DAY))


def describe(v: np.ndarray) -> dict:
    s = SIGNALS[v[0]]
    w = WINDOWS[v[2]]
    return {"signal": s[0], "side": "long" if s[3] > 0 else "short", "universe": f"top {UNIVERSES[v[1]]} by turnover",
            "window": f"{lab.bar_close_minute(w[0]) // 60:02d}:{lab.bar_close_minute(w[0]) % 60:02d}–{lab.bar_close_minute(w[1]) // 60:02d}:{lab.bar_close_minute(w[1]) % 60:02d}",
            "stop_pct": STOPS[v[3]] * 100, "target_pct": TARGETS[v[4]] * 100, "max_hold_min": HOLDS[v[5]] * 5, "trades_per_day": PER_DAY[v[6]]}


def sample(n: int, seed: int = 20261123) -> np.ndarray:
    rng = np.random.default_rng(seed)
    V = np.unique(rng.integers(0, np.array(SPACE), size=(int(n * 1.3), len(SPACE))), axis=0)
    rng.shuffle(V)
    return V[:n].astype(np.int64)


# ------------------------------------------------------------ signals on the panel
@njit(cache=True)
def _signals(O, H, Lw, C, V, kinds, params, out):
    """out[s, r, b] = 1 when signal s fires on row r at the close of bar b (uses bars <= b only)."""
    n, nb = C.shape
    for r in prange(n):
        # 5-minute ATR over the first 6 bars, as the stock's intraday noise scale (known from bar 5 on)
        tr = 0.0
        for b in range(1, 6):
            x = H[r, b] - Lw[r, b]
            y = abs(H[r, b] - C[r, b - 1])
            z = abs(Lw[r, b] - C[r, b - 1])
            tr += max(x, max(y, z))
        atr = tr / 5.0 / C[r, 0] if C[r, 0] > 0 else 0.0
        cum_pv = 0.0
        cum_v = 0.0
        for b in range(nb):
            tp = (H[r, b] + Lw[r, b] + C[r, b]) / 3.0
            cum_pv += tp * V[r, b]
            cum_v += V[r, b]
            vwap = cum_pv / cum_v if cum_v > 0 else C[r, b]
            prev_vwap_above = False
            if b >= 1:
                # relation of the previous close to the previous VWAP (recomputed cheaply)
                pv = cum_pv - tp * V[r, b]
                vv = cum_v - V[r, b]
                pvwap = pv / vv if vv > 0 else C[r, b - 1]
                prev_vwap_above = C[r, b - 1] > pvwap
            for s in range(len(kinds)):
                k = kinds[s]
                p = params[s]
                fire = False
                if b < 6:
                    continue
                if k == 0 or k == 1:  # break of the last-n bars' high / low (bars b-n..b-1)
                    nn = int(p)
                    if b - nn < 0:
                        continue
                    hi = -1e300
                    lo = 1e300
                    for q in range(b - nn, b):
                        if H[r, q] > hi:
                            hi = H[r, q]
                        if Lw[r, q] < lo:
                            lo = Lw[r, q]
                    fire = (C[r, b] > hi) if k == 0 else (C[r, b] < lo)
                elif k == 2:  # close crosses above VWAP
                    fire = (C[r, b] > vwap) and (not prev_vwap_above)
                elif k == 3:  # close crosses below VWAP
                    fire = (C[r, b] < vwap) and prev_vwap_above
                elif k == 4:  # momentum burst up: this bar's return > p x ATR
                    fire = atr > 0 and (C[r, b] / C[r, b - 1] - 1.0) > p * atr
                elif k == 5:  # burst down
                    fire = atr > 0 and (C[r, b] / C[r, b - 1] - 1.0) < -p * atr
                if fire:
                    out[s, r, b] = 1


KIND_ID = {"break_high": 0, "break_low": 1, "vwap_up": 2, "vwap_down": 3, "burst_up": 4, "burst_down": 5}


def signal_masks(L: lab.Lab) -> np.ndarray:
    kinds = np.array([KIND_ID[s[1]] for s in SIGNALS], dtype=np.int64)
    params = np.array([float(s[2]) for s in SIGNALS])
    out = np.zeros((len(SIGNALS), len(L.df), NB), dtype=np.uint8)
    _signals(np.ascontiguousarray(L.o, dtype=np.float64), np.ascontiguousarray(L.h, dtype=np.float64),
             np.ascontiguousarray(L.l, dtype=np.float64), np.ascontiguousarray(L.c, dtype=np.float64),
             np.ascontiguousarray(L.v, dtype=np.float64), kinds, params, out)
    return out


# ------------------------------------------------------------ simulation
@njit(cache=True)
def _cost(buy, sell, day, mult):
    b1 = min(20.0, max(5.0, 0.001 * buy)) if buy > 0 else 0.0
    b2 = min(20.0, max(5.0, 0.001 * sell)) if sell > 0 else 0.0
    brok = b1 + b2
    to = buy + sell
    ex = to * (0.0000297 if day >= EXCH_DAY else 0.0000325)
    sebi = to * 1e-6
    return (brok + ex + sebi + 0.18 * (brok + ex + sebi) + 0.00025 * sell + 0.00003 * buy) * mult


@njit(cache=True)
def _slip(px, day, base):
    tick = 0.01 if (day >= TICK_DAY and px < 250.0) else 0.05
    s = 0.5 * tick / px
    return s if s > base else base


@njit(cache=True)
def _run_one(v, days, first, last, O, H, Lw, C, masks, sides, liq_rank, slip_bps, mult, per_day_out, year_of_day, agg):
    """Daily P&L of one strategy. One position at a time; entries at the close of the signal bar in the window; the
    candidate is the most liquid name firing on that bar."""
    sig = v[0]
    umax = (100, 200, 500)[v[1]]
    w0, w1 = ((2, 21), (2, 44), (9, 44), (21, 56), (9, 68), (2, 68))[v[2]]
    stop = (0.002, 0.003, 0.005, 0.0075, 0.01)[v[3]]
    target = (0.002, 0.003, 0.005, 0.0075, 0.01, 0.015)[v[4]]
    hold = (1, 2, 3, 6, 12)[v[5]]
    per_day = (1, 2, 3, 5)[v[6]]
    side = sides[sig]
    base = slip_bps / 1e4
    for d in range(len(days)):
        day = days[d]
        pnl = 0.0
        ntr = 0
        b = w0
        while b <= w1 and ntr < per_day:
            # the most liquid row firing at bar b
            best = -1
            bestliq = 1e300
            for r in range(first[d], last[d]):
                if masks[sig, r, b] == 1 and liq_rank[r] <= umax and liq_rank[r] < bestliq:
                    best = r
                    bestliq = liq_rank[r]
            if best < 0:
                b += 1
                continue
            r = best
            raw = C[r, b]
            s = _slip(raw, day, base)
            e = raw * (1.0 + s * side)
            q = np.floor(BOOK / e)
            if q < 1:
                b += 1
                continue
            sp = e * (1.0 - stop * side)
            tp = e * (1.0 + target * side)
            xb = min(b + hold, NB - 1)
            x = C[r, xb] * (1.0 - s * side)
            exit_bar = xb
            for i in range(b + 1, xb + 1):
                o = O[r, i]
                h = H[r, i]
                l = Lw[r, i]
                if side > 0:
                    if o <= sp:
                        x = o * (1.0 - s); exit_bar = i; break
                    if o >= tp:
                        x = o; exit_bar = i; break
                    if l <= sp:
                        x = sp * (1.0 - s); exit_bar = i; break
                    if h >= tp:
                        x = tp; exit_bar = i; break
                else:
                    if o >= sp:
                        x = o * (1.0 + s); exit_bar = i; break
                    if o <= tp:
                        x = o; exit_bar = i; break
                    if h >= sp:
                        x = sp * (1.0 + s); exit_bar = i; break
                    if l <= tp:
                        x = tp; exit_bar = i; break
            ev = q * e
            xv = q * x
            buy = ev if side > 0 else xv
            sell = xv if side > 0 else ev
            pnl += (x - e) * q * side - _cost(buy, sell, day, mult)
            ntr += 1
            b = exit_bar + 1  # capital is free again after the exit bar
        per_day_out[d] = pnl
        y = year_of_day[d]
        agg[y, 0] += pnl
        agg[y, 1] += pnl * pnl
        agg[y, 2] += 1.0
        if pnl > 0:
            agg[y, 3] += 1.0
        agg[y, 4] += ntr


@njit(parallel=True, cache=True)
def run_many(V, days, first, last, O, H, Lw, C, masks, sides, liq_rank, slip_bps, mult, year_of_day, n_periods):
    nv = V.shape[0]
    agg = np.zeros((nv, n_periods, 5))
    for i in prange(nv):
        tmp = np.zeros(len(days))
        _run_one(V[i], days, first, last, O, H, Lw, C, masks, sides, liq_rank, slip_bps, mult, tmp, year_of_day, agg[i])
    return agg


def run_daily(v, A, slip_bps=3.0, mult=1.0) -> pd.Series:
    out = np.zeros(len(A["days"]))
    agg = np.zeros((A["n_periods"], 5))
    _run_one(v, A["days"], A["first"], A["last"], A["O"], A["H"], A["Lw"], A["C"], A["masks"], A["sides"], A["liq_rank"],
             slip_bps, mult, out, A["period_of_day"], agg)
    return pd.Series(out, index=A["days"])


# ------------------------------------------------------------ arrays
def arrays(L: lab.Lab, masks: np.ndarray, from_day: int) -> dict:
    day_all = L.df.day.to_numpy()
    days = np.unique(day_all[day_all >= from_day])
    first = np.searchsorted(day_all, days)
    last = np.searchsorted(day_all, days, side="right")
    # liquidity rank within the session by trailing turnover (p_liq is the percentile rank; 1 = most liquid)
    liq = L.df.groupby("day")["p_liq"].rank(ascending=False, method="first").to_numpy().astype(np.float64)
    period = np.where(days < SEL_FROM, 0, np.where(days < SEL_TO, 1, 2))  # 0 earlier, 1 selection, 2 test
    return {"days": days, "first": first, "last": last, "O": np.ascontiguousarray(L.o, dtype=np.float64), "H": np.ascontiguousarray(L.h, dtype=np.float64),
            "Lw": np.ascontiguousarray(L.l, dtype=np.float64), "C": np.ascontiguousarray(L.c, dtype=np.float64), "masks": masks,
            "sides": np.array([s[3] for s in SIGNALS], dtype=np.int64), "liq_rank": liq, "period_of_day": period.astype(np.int64), "n_periods": 3}


def stats_from_agg(a: np.ndarray) -> dict:
    n = max(a[2], 1.0)
    mean = a[0] / n
    sd = max(a[1] / n - mean * mean, 1e-12) ** 0.5
    return {"days": int(a[2]), "net_rs": round(float(a[0])), "per_day_rs": round(float(mean)), "per_month_pct": round(float(mean * 21 / BOOK * 100), 2),
            "day_win_rate": round(float(a[3] / n), 3), "trades_per_day": round(float(a[4] / n), 2), "sharpe": round(float(mean / sd * np.sqrt(252)), 2) if sd > 0 else None}


def search(n: int = 100_000, panel: str = "lab_n500_500", top: int = 100) -> dict:
    """Draw n scalping strategies, simulate them on the panel, choose the top-`top` on the selection window by Sharpe
    with a minimum of 100 trading days and positive net, and report them on the later test months."""
    t0 = time.time()
    lab.LAB = config.DATA / panel
    L = lab.load(final=True)
    masks = signal_masks(L)
    A = arrays(L, masks, SEL_FROM)
    V = sample(n)
    agg = run_many(V, A["days"], A["first"], A["last"], A["O"], A["H"], A["Lw"], A["C"], A["masks"], A["sides"], A["liq_rank"], 3.0, 1.0,
                   A["period_of_day"], A["n_periods"])
    sel = agg[:, 1, :]
    n_ = np.maximum(sel[:, 2], 1)
    mean = sel[:, 0] / n_
    sd = np.sqrt(np.maximum(sel[:, 1] / n_ - mean ** 2, 1e-12))
    sharpe = mean / sd * np.sqrt(252)
    enough = (sel[:, 2] >= 100) & (sel[:, 4] / n_ >= 0.2)
    ok = enough & (sel[:, 0] > 0)
    # the profitable ones first (by Sharpe); when fewer than `top` exist, the rest are the least-bad by Sharpe, so the
    # table is never empty but the profitable count is reported honestly
    order = np.argsort(-np.where(ok, sharpe, -np.inf))[: int(ok.sum())]
    if len(order) < top:
        rest = np.argsort(-np.where(enough & ~ok, sharpe, -np.inf))[: top - len(order)]
        order = np.concatenate([order, rest])
    rows = []
    for rank, i in enumerate(order, 1):
        rows.append({"rank": rank, "id": int(i), "dna": V[i].tolist(), **describe(V[i]),
                     "selection_2024_01_to_2026_04": stats_from_agg(agg[i, 1]), "test_2026_05_on": stats_from_agg(agg[i, 2])})
    pm = mean * 21 / BOOK * 100
    # the universe for the daily paper run on the server (which has no panel): every symbol of the last session, with
    # its liquidity rank there
    lastday = int(L.df.day.max())
    liq = L.df[L.df.day.to_numpy() == lastday].set_index("symbol")["p_liq"].rank(ascending=False, method="first")
    today = (dt.date.today() - dt.date(1970, 1, 1)).days
    cost_rt = float(_cost(BOOK, BOOK, today, 1.0) + 2 * 3e-4 * BOOK)
    out = {"generated_at": time.time(), "panel": panel, "strategies": int(len(V)), "profitable_in_selection": int((sel[:, 0] > 0).sum()),
           "profitable_in_selection_strict": int(ok.sum()), "cost_per_round_trip_rs": round(cost_rt), "cost_per_round_trip_pct": round(cost_rt / BOOK * 100, 3),
           "universe_symbols": sorted(liq.index), "liq_rank": {s_: int(liq[s_]) for s_ in liq.index},
           "profitable_in_selection_pct": round(float((sel[:, 0] > 0).mean() * 100), 1),
           "selection_per_month_pct_quantiles": {q: round(float(np.quantile(pm, q)), 2) for q in (0.5, 0.9, 0.99, 1.0)},
           "top": rows, "test_summary": {"top100_mean_per_month_pct_test": round(float(np.mean([r["test_2026_05_on"]["per_month_pct"] for r in rows])), 2),
                                         "top100_share_positive_in_test": round(float(np.mean([r["test_2026_05_on"]["net_rs"] > 0 for r in rows])), 2)},
           "elapsed_s": round(time.time() - t0)}
    d = config.DATA / "scalping"
    d.mkdir(exist_ok=True)
    (d / "results.json").write_text(json.dumps(out, indent=1))
    np.save(d / "top_dna.npy", V[order])
    return out


# ------------------------------------------------------------ daily paper results (server)
def daily(day: int | None = None) -> dict:
    """Paper result of the chosen strategies on one session, from that day's 5-minute bars of the panel universe.
    Writes data/scalping/daily/<date>.json; the admin page shows the running record."""
    from . import live
    from .sessions import ist_minute

    day = day if day is not None else live.today_ist()
    d = config.DATA / "scalping"
    V = np.load(d / "top_dna.npy")
    res = json.loads((d / "results.json").read_text())
    syms = sorted({s for s in res.get("universe_symbols", [])})
    if not syms:
        # the universe: every symbol in the panel's last 60 sessions, with its liquidity rank from the last session
        lab.LAB = config.DATA / res["panel"]
        L = lab.load(final=True)
        lastday = int(L.df.day.max())
        m = L.df.day.to_numpy() == lastday
        liq = L.df[m].set_index("symbol")["p_liq"].rank(ascending=False, method="first")
        syms = sorted(liq.index)
        res["universe_symbols"] = syms
        res["liq_rank"] = {s: int(liq[s]) for s in syms}
        (d / "results.json").write_text(json.dumps(res, indent=1))
    got = live.fetch_range_day(syms, day)
    rows, keep = [], []
    for s in syms:
        df_ = got.get(s)
        if df_ is None:
            continue
        a = live.paths(df_, day)
        if a is None:
            continue
        rows.append(a)
        keep.append(s)
    if not rows:
        return {"day": day_to_date(day).isoformat(), "status": "no bars"}
    P = np.stack(rows)  # (n, 5, NB)
    df = pd.DataFrame({"day": day, "symbol": keep, "p_liq": [1.0 / res["liq_rank"][s] for s in keep]})
    Ld = lab.Lab(df, P[:, 0], P[:, 1], P[:, 2], P[:, 3], P[:, 4], np.full(len(keep), day_to_date(day).year), True)
    masks = signal_masks(Ld)
    A = arrays(Ld, masks, 0)
    out = []
    for i, v in enumerate(V):
        p = run_daily(v, A)
        out.append({"rank": i + 1, "net_rs": round(float(p.iloc[0]), 2)})
    dd = d / "daily"
    dd.mkdir(exist_ok=True)
    rec = {"day": day_to_date(day).isoformat(), "symbols": len(keep), "results": out,
           "summary": {"mean_net_rs": round(float(np.mean([o["net_rs"] for o in out])), 2), "positive": int(sum(o["net_rs"] > 0 for o in out)),
                       "best": max(out, key=lambda o: o["net_rs"]), "worst": min(out, key=lambda o: o["net_rs"])}}
    (dd / f"{rec['day']}.json").write_text(json.dumps(rec, indent=1))
    return rec


def report() -> dict:
    d = config.DATA / "scalping"
    if not (d / "results.json").exists():
        return {"status": "no search yet"}
    res = json.loads((d / "results.json").read_text())
    days = sorted((d / "daily").glob("*.json")) if (d / "daily").exists() else []
    daily_ = [json.loads(p.read_text()) for p in days]
    per = {}
    for rec in daily_:
        for o in rec["results"]:
            per.setdefault(o["rank"], []).append(o["net_rs"])
    for r in res["top"]:
        xs = per.get(r["rank"], [])
        r["paper"] = {"days": len(xs), "net_rs": round(sum(xs), 2), "positive_days": int(sum(x > 0 for x in xs))}
    return {"search": {k: v for k, v in res.items() if k not in ("top", "universe_symbols", "liq_rank")}, "top": res["top"],
            "daily": [{"day": rec["day"], **rec["summary"]} for rec in daily_]}
