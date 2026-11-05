"""Causal indicators: the value at bar i uses bars 0..i only.

Warm-up bars are NaN, never a guessed value. Wilder smoothing (RSI, ATR, ADX)
is seeded with a simple mean of the first `n` values, as Wilder defined it.
"""

from __future__ import annotations

import numpy as np
from numba import njit


@njit(cache=True)
def sma(x, n):
    out = np.full(len(x), np.nan)
    s = 0.0
    cnt = 0
    for i in range(len(x)):
        v = x[i]
        if np.isnan(v):
            s = 0.0
            cnt = 0
            continue
        s += v
        cnt += 1
        if cnt > n:
            s -= x[i - n]
            cnt = n
        if cnt == n:
            out[i] = s / n
    return out


@njit(cache=True)
def ema(x, n):
    """EMA seeded with the SMA of its first n valid values; skips a NaN prefix."""
    out = np.full(len(x), np.nan)
    a = 2.0 / (n + 1.0)
    start = 0
    while start < len(x) and np.isnan(x[start]):
        start += 1
    if start + n > len(x):
        return out
    s = 0.0
    for i in range(start, start + n):
        s += x[i]
    prev = s / n
    out[start + n - 1] = prev
    for i in range(start + n, len(x)):
        v = x[i]
        if np.isnan(v):
            out[i] = prev
            continue
        prev = a * v + (1.0 - a) * prev
        out[i] = prev
    return out


@njit(cache=True)
def wilder(x, n):
    """Wilder's smoothing (RMA) seeded with the mean of the first n valid values."""
    out = np.full(len(x), np.nan)
    start = 0
    while start < len(x) and np.isnan(x[start]):
        start += 1
    if start + n > len(x):
        return out
    s = 0.0
    for i in range(start, start + n):
        s += x[i]
    prev = s / n
    out[start + n - 1] = prev
    for i in range(start + n, len(x)):
        prev = (prev * (n - 1) + x[i]) / n
        out[i] = prev
    return out


@njit(cache=True)
def rsi(close, n):
    m = len(close)
    up = np.full(m, np.nan)
    dn = np.full(m, np.nan)
    for i in range(1, m):
        d = close[i] - close[i - 1]
        up[i] = d if d > 0 else 0.0
        dn[i] = -d if d < 0 else 0.0
    au = wilder(up, n)
    ad = wilder(dn, n)
    out = np.full(m, np.nan)
    for i in range(m):
        if np.isnan(au[i]) or np.isnan(ad[i]):
            continue
        if ad[i] == 0.0:
            out[i] = 100.0 if au[i] > 0 else 50.0
        else:
            out[i] = 100.0 - 100.0 / (1.0 + au[i] / ad[i])
    return out


@njit(cache=True)
def true_range(h, l, c):
    m = len(c)
    tr = np.full(m, np.nan)
    if m == 0:
        return tr
    tr[0] = h[0] - l[0]
    for i in range(1, m):
        a = h[i] - l[i]
        b = abs(h[i] - c[i - 1])
        d = abs(l[i] - c[i - 1])
        tr[i] = max(a, max(b, d))
    return tr


@njit(cache=True)
def atr(h, l, c, n):
    return wilder(true_range(h, l, c), n)


@njit(cache=True)
def adx(h, l, c, n):
    """Returns (+DI, -DI, ADX)."""
    m = len(c)
    pdm = np.full(m, np.nan)
    ndm = np.full(m, np.nan)
    for i in range(1, m):
        upm = h[i] - h[i - 1]
        dnm = l[i - 1] - l[i]
        pdm[i] = upm if (upm > dnm and upm > 0) else 0.0
        ndm[i] = dnm if (dnm > upm and dnm > 0) else 0.0
    tr = true_range(h, l, c)
    tr[0] = np.nan
    atr_ = wilder(tr, n)
    sp = wilder(pdm, n)
    sn = wilder(ndm, n)
    pdi = np.full(m, np.nan)
    ndi = np.full(m, np.nan)
    dx = np.full(m, np.nan)
    for i in range(m):
        if np.isnan(atr_[i]) or atr_[i] == 0.0:
            continue
        pdi[i] = 100.0 * sp[i] / atr_[i]
        ndi[i] = 100.0 * sn[i] / atr_[i]
        s = pdi[i] + ndi[i]
        dx[i] = 0.0 if s == 0.0 else 100.0 * abs(pdi[i] - ndi[i]) / s
    return pdi, ndi, wilder(dx, n)


@njit(cache=True)
def rolling_std(x, n):
    """Population standard deviation over the last n values."""
    m = len(x)
    out = np.full(m, np.nan)
    for i in range(n - 1, m):
        s = 0.0
        ok = True
        for j in range(i - n + 1, i + 1):
            if np.isnan(x[j]):
                ok = False
                break
            s += x[j]
        if not ok:
            continue
        mu = s / n
        v = 0.0
        for j in range(i - n + 1, i + 1):
            v += (x[j] - mu) ** 2
        out[i] = np.sqrt(v / n)
    return out


@njit(cache=True)
def prior_max(x, n):
    """Highest value over the n bars BEFORE bar i (bar i itself excluded)."""
    m = len(x)
    out = np.full(m, np.nan)
    for i in range(n, m):
        best = x[i - n]
        for j in range(i - n + 1, i):
            if x[j] > best:
                best = x[j]
        out[i] = best
    return out


@njit(cache=True)
def prior_min(x, n):
    m = len(x)
    out = np.full(m, np.nan)
    for i in range(n, m):
        best = x[i - n]
        for j in range(i - n + 1, i):
            if x[j] < best:
                best = x[j]
        out[i] = best
    return out


@njit(cache=True)
def prior_mean(x, n):
    """Mean of the n bars before bar i — e.g. average volume to compare bar i against."""
    m = len(x)
    out = np.full(m, np.nan)
    s = 0.0
    for i in range(m):
        if i >= n:
            out[i] = s / n
        s += x[i]
        if i >= n:
            s -= x[i - n]
    return out


@njit(cache=True)
def supertrend_dir(h, l, c, n, mult):
    """+1 in an up-trend, -1 in a down-trend, 0 during warm-up."""
    m = len(c)
    a = atr(h, l, c, n)
    d = np.zeros(m, dtype=np.int8)
    fu = np.nan
    fl = np.nan
    trend = 0
    for i in range(m):
        if np.isnan(a[i]):
            continue
        mid = (h[i] + l[i]) / 2.0
        bu = mid + mult * a[i]
        bl = mid - mult * a[i]
        if np.isnan(fu):
            fu, fl, trend = bu, bl, 1
        else:
            fu = bu if (bu < fu or c[i - 1] > fu) else fu
            fl = bl if (bl > fl or c[i - 1] < fl) else fl
            if trend == 1 and c[i] < fl:
                trend = -1
            elif trend == -1 and c[i] > fu:
                trend = 1
        d[i] = trend
    return d


@njit(cache=True)
def session_vwap(h, l, c, v, day):
    m = len(c)
    out = np.full(m, np.nan)
    pv = 0.0
    vv = 0.0
    for i in range(m):
        if i == 0 or day[i] != day[i - 1]:
            pv = 0.0
            vv = 0.0
        tp = (h[i] + l[i] + c[i]) / 3.0
        pv += tp * v[i]
        vv += v[i]
        out[i] = pv / vv if vv > 0 else tp
    return out


@njit(cache=True)
def prev_session_hl(h, l, day):
    """Previous session's high and low, broadcast over the current session."""
    m = len(h)
    ph = np.full(m, np.nan)
    pl = np.full(m, np.nan)
    cur_h = -np.inf
    cur_l = np.inf
    last_h = np.nan
    last_l = np.nan
    for i in range(m):
        if i > 0 and day[i] != day[i - 1]:
            last_h, last_l = cur_h, cur_l
            cur_h, cur_l = -np.inf, np.inf
        ph[i] = last_h
        pl[i] = last_l
        if h[i] > cur_h:
            cur_h = h[i]
        if l[i] < cur_l:
            cur_l = l[i]
    return ph, pl


@njit(cache=True)
def opening_range(h, l, minute, day, open_min, window, interval):
    """High/low of the bars that END within the session's first `window`
    minutes, available from the first bar after them (NaN until then)."""
    m = len(h)
    oh = np.full(m, np.nan)
    ol = np.full(m, np.nan)
    rh = -np.inf
    rl = np.inf
    for i in range(m):
        if i == 0 or day[i] != day[i - 1]:
            rh, rl = -np.inf, np.inf
        if minute[i] + interval <= open_min + window:
            if h[i] > rh:
                rh = h[i]
            if l[i] < rl:
                rl = l[i]
        elif rh > -np.inf:
            oh[i] = rh
            ol[i] = rl
    return oh, ol


def cross_above(a: np.ndarray, b: np.ndarray | float) -> np.ndarray:
    """True on the bar where a moves from <= b to > b. NaN never crosses."""
    b_arr = np.broadcast_to(np.asarray(b, dtype=float), a.shape)
    out = np.zeros(len(a), dtype=np.bool_)
    if len(a) < 2:
        return out
    with np.errstate(invalid="ignore"):
        out[1:] = (a[1:] > b_arr[1:]) & (a[:-1] <= b_arr[:-1])
    return out


def cross_below(a: np.ndarray, b: np.ndarray | float) -> np.ndarray:
    b_arr = np.broadcast_to(np.asarray(b, dtype=float), a.shape)
    out = np.zeros(len(a), dtype=np.bool_)
    if len(a) < 2:
        return out
    with np.errstate(invalid="ignore"):
        out[1:] = (a[1:] < b_arr[1:]) & (a[:-1] >= b_arr[:-1])
    return out


def shift(x: np.ndarray, k: int = 1, fill=np.nan) -> np.ndarray:
    out = np.empty_like(x, dtype=float if x.dtype.kind == "f" else x.dtype)
    if k <= 0:
        return x.copy()
    out[:k] = fill
    out[k:] = x[:-k]
    return out
