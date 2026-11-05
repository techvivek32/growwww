"""DNA -> boolean signal arrays. Every array at bar i is a function of bars
0..i only; the engine acts on it at bar i+1's open. A test perturbs future
bars and checks no past signal changes."""

from __future__ import annotations

import numpy as np

import datetime as dt

from . import config
from . import indicators as ind
from .costs import STATUTORY
from .dna import canonical
from .series import Cache

COST_FLOOR_DAY = (STATUTORY[0].valid_from - dt.date(1970, 1, 1)).days
TRADE_FROM_DAY = max(COST_FLOOR_DAY, (dt.date.fromisoformat(config.TRADE_FROM) - dt.date(1970, 1, 1)).days)

SESSION_WINDOWS = {"morning": (9 * 60 + 30, 11 * 60 + 30), "afternoon": (12 * 60 + 30, 14 * 60 + 45), "skip_open": (9 * 60 + 30, 14 * 60 + 45)}


def _f(x) -> np.ndarray:
    return np.asarray(x, dtype=np.float64)


def trigger(entry: dict, ic: Cache) -> tuple[np.ndarray, np.ndarray]:
    """Raw (long, short) entry events for one entry rule, cached per series."""
    key = canonical(entry)
    hit = ic.triggers.get(key)
    if hit is not None:
        return hit
    s = ic.s
    c, o, h, l = s.c, s.o, s.h, s.l
    r = entry["rule"]
    n = len(c)
    same_day_prev = np.zeros(n, dtype=bool)
    same_day_prev[1:] = s.day[1:] == s.day[:-1]

    if r == "ema_cross":
        a, b = ic.ema(entry["fast"]), ic.ema(entry["slow"])
        L, S = ind.cross_above(a, b), ind.cross_below(a, b)
    elif r == "price_ema":
        e = ic.ema(entry["n"])
        L, S = ind.cross_above(c, e), ind.cross_below(c, e)
    elif r == "supertrend":
        d = ic.supertrend(int(entry["n"]), float(entry["mult"])).astype(np.int64)
        pd_ = np.zeros(n, dtype=np.int64)
        pd_[1:] = d[:-1]
        L, S = (d == 1) & (pd_ == -1), (d == -1) & (pd_ == 1)
    elif r == "di_cross":
        pdi, ndi, ax = ic.adx(entry["n"])
        with np.errstate(invalid="ignore"):
            strong = ax > entry["t"]
        L, S = ind.cross_above(pdi, ndi) & strong, ind.cross_above(ndi, pdi) & strong
    elif r == "rsi_cross":
        x = ic.rsi(entry["n"])
        L, S = ind.cross_above(x, entry["level"]), ind.cross_below(x, 100 - entry["level"])
    elif r == "macd_cross":
        f, sl, sg = (int(p) for p in entry["cfg"].split("-"))
        line, sig = ic.macd(f, sl, sg)
        L, S = ind.cross_above(line, sig), ind.cross_below(line, sig)
        if entry["zero"] == "with":
            with np.errstate(invalid="ignore"):
                L &= line > 0
                S &= line < 0
    elif r == "roc_atr":
        k = entry["n"]
        a = ic.atr(14)
        z = np.full(n, np.nan)
        with np.errstate(invalid="ignore", divide="ignore"):
            z[k:] = (c[k:] - c[:-k]) / a[k:]
        L, S = ind.cross_above(z, entry["t"]), ind.cross_below(z, -entry["t"])
    elif r == "bb_reentry":
        lo, _mid, up = ic.bands(entry["n"], float(entry["k"]))
        L, S = ind.cross_above(c, lo), ind.cross_below(c, up)
    elif r == "rsi_reversal":
        x = ic.rsi(entry["n"])
        L, S = ind.cross_above(x, entry["level"]), ind.cross_below(x, 100 - entry["level"])
    elif r == "donchian":
        ph, pl = ic.prior_high(entry["n"]), ic.prior_low(entry["n"])
        L, S = ind.cross_above(c, ph), ind.cross_below(c, pl)
    elif r == "prev_day":
        ph, pl = ic.prev_day_hl()
        a = ic.atr(14)
        up, dn = ph + entry["buf"] * a, pl - entry["buf"] * a
        L = ind.cross_above(c, up) & same_day_prev
        S = ind.cross_below(c, dn) & same_day_prev
    elif r == "opening_range":
        oh, ol = ic.opening_range(entry["win"])
        with np.errstate(invalid="ignore"):
            above = c > oh
            below = c < ol
        pa = np.zeros(n, dtype=bool)
        pb = np.zeros(n, dtype=bool)
        pa[1:] = above[:-1] & same_day_prev[1:]
        pb[1:] = below[:-1] & same_day_prev[1:]
        L, S = above & ~pa, below & ~pb
    elif r == "vwap_cross":
        vw = ic.vwap()
        rv = ic.relvol(20)
        with np.errstate(invalid="ignore"):
            vol_ok = (rv >= entry["rv"]) if entry["rv"] > 0 else np.ones(n, dtype=bool)
        L = ind.cross_above(c, vw) & same_day_prev & vol_ok
        S = ind.cross_below(c, vw) & same_day_prev & vol_ok
    elif r == "volume_spike":
        rv = ic.relvol(20)
        a = ic.atr(14)
        with np.errstate(invalid="ignore", divide="ignore"):
            body = (c - o) / a
            L = (rv >= entry["rv"]) & (body >= entry["body"])
            S = (rv >= entry["rv"]) & (body <= -entry["body"])
    elif r == "inside_break":
        inside = np.zeros(n, dtype=bool)
        inside[2:] = (h[1:-1] < h[:-2]) & (l[1:-1] > l[:-2])
        ph = ind.shift(h, 1)
        pl = ind.shift(l, 1)
        with np.errstate(invalid="ignore"):
            L, S = inside & (c > ph), inside & (c < pl)
    elif r == "engulfing":
        a = ic.atr(14)
        po, pc = ind.shift(o, 1), ind.shift(c, 1)
        with np.errstate(invalid="ignore"):
            big = np.abs(c - o) >= entry["body"] * a
            L = (pc < po) & (c > o) & (o <= pc) & (c >= po) & big
            S = (pc > po) & (c < o) & (o >= pc) & (c <= po) & big
    elif r == "pullback":
        k = entry["n"]
        e = ic.ema(entry["trend"])
        down = np.zeros(n, dtype=bool)
        up = np.zeros(n, dtype=bool)
        if n > k + 1:
            dn_run = np.ones(n - k - 1, dtype=bool)
            up_run = np.ones(n - k - 1, dtype=bool)
            # bars i-1 .. i-k each closed below (above) the bar before them
            for j in range(1, k + 1):
                cur = c[k + 1 - j : n - j]
                prev = c[k - j : n - j - 1]
                dn_run &= cur < prev
                up_run &= cur > prev
            down[k + 1 :] = dn_run
            up[k + 1 :] = up_run
        ph, pl = ind.shift(h, 1), ind.shift(l, 1)
        with np.errstate(invalid="ignore"):
            L = (c > e) & down & (c > ph)
            S = (c < e) & up & (c < pl)
    elif r == "range_expansion":
        pa = ind.shift(ic.atr(14), 1)
        with np.errstate(invalid="ignore"):
            wide = ic.tr() >= entry["k"] * pa
        L, S = wide & (c > o), wide & (c < o)
    elif r == "bb_squeeze":
        lo, mid, up = ic.bands(20, 2.0)
        with np.errstate(invalid="ignore", divide="ignore"):
            bw = (up - lo) / mid
        pmin = ind.prior_min(np.where(np.isnan(bw), np.inf, bw), entry["q"])
        with np.errstate(invalid="ignore"):
            sq = bw <= pmin  # this bar's width is at a q-bar low
        recent = np.zeros(n, dtype=bool)
        for j in range(1, 6):
            recent[j:] |= sq[:-j]
        L = recent & ind.cross_above(c, up)
        S = recent & ind.cross_below(c, lo)
    elif r == "ibs":
        # internal bar strength: where the bar closed inside its own range
        rg = h - l
        with np.errstate(invalid="ignore", divide="ignore"):
            v = np.where(rg > 0, (c - l) / rg, np.nan)
            L, S = v <= entry["t"], v >= 1 - entry["t"]
    elif r == "down_days":
        k = entry["n"]
        down = np.zeros(n, dtype=bool)
        up = np.zeros(n, dtype=bool)
        if n > k:
            dn_run = np.ones(n - k, dtype=bool)
            up_run = np.ones(n - k, dtype=bool)
            # closes i, i-1, ..., i-k+1 each below (above) the close before
            for j in range(k):
                cur = c[k - j : n - j]
                prev = c[k - j - 1 : n - j - 1]
                dn_run &= cur < prev
                up_run &= cur > prev
            down[k:] = dn_run
            up[k:] = up_run
        L, S = down, up
    elif r == "gap":
        # the session's first bar opened g away from the previous close;
        # the signal is that first bar's close
        first = ~same_day_prev
        prev_close = ind.shift(c, 1)
        with np.errstate(invalid="ignore", divide="ignore"):
            g = o / prev_close - 1
            at = first & np.isfinite(g)
            up_gap, dn_gap = at & (g >= entry["g"]), at & (g <= -entry["g"])
        L, S = (up_gap, dn_gap) if entry["mode"] == "go" else (dn_gap, up_gap)
    elif r == "nr_break":
        # bar i-1 was the narrowest of its last n bars; bar i closes beyond it
        k = entry["n"]
        rg = h - l
        with np.errstate(invalid="ignore"):
            nr = rg <= ind.prior_min(rg, k - 1)
        prev_nr = np.zeros(n, dtype=bool)
        prev_nr[1:] = nr[:-1]
        ph, pl = ind.shift(h, 1), ind.shift(l, 1)
        with np.errstate(invalid="ignore"):
            L, S = prev_nr & (c > ph), prev_nr & (c < pl)
    else:
        raise ValueError(f"unknown rule {r}")

    out = (np.asarray(L, dtype=bool), np.asarray(S, dtype=bool))
    ic.triggers[key] = out
    return out


def filter_mask(f: dict, ic: Cache) -> tuple[np.ndarray, np.ndarray]:
    key = canonical(f)
    hit = ic.filters.get(key)
    if hit is not None:
        return hit
    s = ic.s
    n = len(s.c)
    k = f["f"]
    with np.errstate(invalid="ignore"):
        if k == "trend_ema":
            e = ic.ema(f["n"])
            L, S = s.c > e, s.c < e
        elif k == "adx_min":
            ax = ic.adx(14)[2]
            L = S = ax > f["t"]
        elif k == "adx_max":
            ax = ic.adx(14)[2]
            L = S = ax < f["t"]
        elif k == "relvol_min":
            L = S = ic.relvol(20) >= f["t"]
        elif k == "session":
            lo, hi = SESSION_WINDOWS[f["w"]]
            nm = np.full(n, -1)
            nm[:-1] = s.sess.minute[1:]  # the entry bar's scheduled open time
            L = S = (nm >= lo) & (nm <= hi)
        elif k == "htf_trend":
            t = ic.htf_trend(f["htf"], f["n"])
            L, S = t > 0, t < 0
        elif k in ("deliv_min", "deliv_max", "deliv_rel"):
            share, rel = ic.delivery()
            if k == "deliv_min":
                L = S = share >= f["t"]
            elif k == "deliv_max":
                L = S = share <= f["t"]
            else:
                L = S = rel >= f["t"]
        else:
            raise ValueError(f"unknown filter {k}")
    out = (np.asarray(L, dtype=bool), np.asarray(S, dtype=bool))
    ic.filters[key] = out
    return out


def build(d: dict, ic: Cache) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(enter_long, enter_short, exit_long, exit_short) for one strategy."""
    L, S = trigger(d["entry"], ic)
    el, es = L.copy(), S.copy()
    for f in d["filters"]:
        fl, fs = filter_mask(f, ic)
        el &= fl
        es &= fs
    # No trade before the cost model's first schedule or before the daily data is
    # reliable (config.TRADE_FROM); earlier bars only warm up indicators. And
    # none on a day the stock was not in the F&O list (point-in-time), so the
    # universe is not today's winners.
    ok = ic.s.sess.entry_ok & (ic.s.day >= TRADE_FROM_DAY)
    if ic.s.member is not None:
        ok = ok & ic.s.member
    el &= ok
    es &= ok
    if d["side"] == "long":
        es[:] = False
    elif d["side"] == "short":
        el[:] = False
    if d["exit"]["opp"]:
        xl, xs = S, L
    else:
        z = np.zeros(len(L), dtype=bool)
        xl = xs = z
    return el, es, xl, xs
