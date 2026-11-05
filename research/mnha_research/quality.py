"""Data quality checks, and series breaks at suspected corporate actions.

A split or bonus in unadjusted data shows up as an overnight jump that no
strategy could have traded. Without a verifiable corporate-action feed on
this host, such a jump is NOT "adjusted" with a guessed ratio: the series is
cut there, and the pieces are backtested separately so no trade or indicator
spans it. If Groww's history is already adjusted, no breaks are found.

Groww's DAILY bars are split/bonus-adjusted; its INTRADAY bars are not. So
intraday bars are reconciled against the daily ones (`reconcile`): the ratio
f = daily close / last intraday close is constant between corporate actions,
and a lasting step in it is a split or bonus — a break for the intraday
series. Intraday highs and lows outside the day's daily range (scaled by f)
are bad ticks and are clipped back to it (e.g. 2025-05-12, when ~215 stocks
carry one 15-minute high about 100x the price). A symbol whose two series
keep disagreeing is unusable at every interval.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from . import config, db
from .sessions import ist_day, ist_minute
from .series import load_frame

GAP_DOWN = 0.75  # open / previous close below this → break
GAP_UP = 1.35
STEP = 0.05  # a lasting move of the daily/intraday ratio larger than this is a corporate action
STEP_WINDOW = 5  # sessions each side whose median ratio must differ
MAX_STEPS = 10  # more steps than this: the two series disagree, the symbol is unusable
MAX_DISAGREE = 0.05  # or more than this share of days off their segment's ratio by > STEP
RANGE_TOL = 0.03  # intraday high/low may exceed the scaled daily range by this before clipping
MAX_BAD_SHARE = 0.2  # a day with more of its bars outside the daily range is a series mismatch, not bad prints


def expected_bars(interval: int) -> int:
    return math.ceil((config.SESSION_CLOSE - config.SESSION_OPEN) / interval)


def breaks_from_daily(df: pd.DataFrame) -> list[int]:
    if df is None or len(df) < 2:
        return []
    o = df["open"].to_numpy()
    c = df["close"].to_numpy()
    d = ist_day(df["time"].to_numpy(dtype=np.int64))
    with np.errstate(divide="ignore", invalid="ignore"):
        r = o[1:] / c[:-1]
    idx = np.nonzero((r < GAP_DOWN) | (r > GAP_UP))[0] + 1
    return [int(d[i]) for i in idx]


def _day_factor(intra: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    """Per IST day with both series: daily high/low/close and f = daily close / last intraday close."""
    day = ist_day(intra["time"].to_numpy(dtype=np.int64))
    last = pd.Series(intra["close"].to_numpy(), index=day).groupby(level=0).last()
    dd = pd.DataFrame({"high": daily["high"].to_numpy(), "low": daily["low"].to_numpy(), "close": daily["close"].to_numpy()},
                      index=ist_day(daily["time"].to_numpy(dtype=np.int64)))
    dd = dd[~dd.index.duplicated(keep="last")]
    m = dd.join(last.rename("last"), how="inner")
    m = m[(m["last"] > 0) & (m["close"] > 0)]
    m["f"] = m["close"] / m["last"]
    return m


def factor_steps(m: pd.DataFrame) -> list[int]:
    """Days where the daily/intraday ratio steps by more than STEP and stays
    there: the median over the STEP_WINDOW sessions from that day differs from
    the median over the STEP_WINDOW before it. One day per step."""
    if len(m) < 2:
        return []
    r = np.log(m["f"])
    before = r.shift(1).rolling(STEP_WINDOW, min_periods=1).median()
    after = r[::-1].rolling(STEP_WINDOW, min_periods=1).median()[::-1]
    flag = ((after - before).abs() > np.log1p(STEP)).to_numpy().copy()
    flag[0] = False
    move = np.nan_to_num(r.diff().abs().to_numpy())
    days = m.index.to_numpy()
    out, i = [], 0
    while i < len(flag):
        if flag[i]:
            j = i
            while j + 1 < len(flag) and flag[j + 1]:
                j += 1
            k = i + int(np.nanargmax(move[i : j + 1]))
            out.append(int(days[k]))
            i = j + 1
        else:
            i += 1
    return out


def reconcile(intra: pd.DataFrame, daily: pd.DataFrame | None) -> tuple[pd.DataFrame, list[int], dict]:
    """Intraday bars made consistent with the adjusted daily bars:
    (frame with bad-tick highs/lows clipped, corporate-action break days, stats)."""
    if intra is None or intra.empty or daily is None or daily.empty:
        return intra, [], {"steps": 0, "clipped": 0, "disagree": 0.0}
    m = _day_factor(intra, daily)
    steps = factor_steps(m)
    # between steps the ratio should sit still; days far off their segment's
    # median mean the two series are different price paths
    r = np.log(m["f"].to_numpy())
    seg = np.searchsorted(np.array(steps, dtype=np.int64), m.index.to_numpy(), side="right")
    med = pd.Series(r).groupby(seg).transform("median").to_numpy()
    disagree = float(np.mean(np.abs(r - med) > np.log1p(STEP))) if len(r) else 0.0
    day = ist_day(intra["time"].to_numpy(dtype=np.int64))
    f = m["f"].reindex(day).to_numpy()
    hi = (m["high"] / m["f"]).reindex(day).to_numpy() * (1 + RANGE_TOL)
    lo = (m["low"] / m["f"]).reindex(day).to_numpy() * (1 - RANGE_TOL)
    o, h, l, c = (intra[k].to_numpy(dtype=np.float64) for k in ("open", "high", "low", "close"))
    known = np.isfinite(f)
    # an open or close outside the day's official range never traded (e.g. every stock printing
    # ~100x at 10:35-10:40 on 2025-05-12): carry the previous clean close of the same day forward
    # (the next clean open for the day's first bars), as for a missing bar
    with np.errstate(invalid="ignore"):
        bad_o = known & ((o > hi) | (o < lo))
        bad_c = known & ((c > hi) | (c < lo))
    # isolated prints only: when much of a day sits outside the daily range, the two series
    # disagree about that day (a vendor/scale problem), and the intraday path - internally
    # consistent - is kept as it is
    share = pd.Series((bad_o | bad_c).astype(float)).groupby(day).transform("mean").to_numpy()
    isolated = share <= MAX_BAD_SHARE
    bad_o &= isolated
    bad_c &= isolated
    fixed = int(bad_o.sum() + bad_c.sum())
    if fixed:
        cc = pd.Series(np.where(bad_c, np.nan, c))
        oo = pd.Series(np.where(bad_o, np.nan, o))
        prev_c = cc.groupby(day).shift(1).groupby(day).ffill()
        fill = prev_c.fillna(oo.groupby(day).bfill()).fillna(cc.groupby(day).bfill()).to_numpy()
        o = np.where(bad_o, np.where(np.isfinite(prev_c.to_numpy()), prev_c.to_numpy(), fill), o)
        c = np.where(bad_c, cc.groupby(day).ffill().fillna(pd.Series(fill)).to_numpy(), c)
    with np.errstate(invalid="ignore"):
        bad_h = known & (h > np.maximum(hi, np.maximum(o, c)))
        bad_l = known & (l < np.minimum(lo, np.minimum(o, c)))
        # a fixed bar keeps no extreme of its own beyond its (repaired) open and close
        bad_h |= (bad_o | bad_c) & (h > np.maximum(o, c))
        bad_l |= (bad_o | bad_c) & (l < np.minimum(o, c))
    out = intra
    if fixed or bad_h.any() or bad_l.any():
        out = intra.copy()
        out["open"], out["close"] = o, c
        oc_bad = bad_o | bad_c
        out.loc[bad_h, "high"] = np.where(oc_bad, np.maximum(o, c), np.maximum(hi, np.maximum(o, c)))[bad_h]
        out.loc[bad_l, "low"] = np.where(oc_bad, np.minimum(o, c), np.minimum(lo, np.minimum(o, c)))[bad_l]
        out["high"] = np.maximum(out["high"].to_numpy(), np.maximum(o, c))
        out["low"] = np.minimum(out["low"].to_numpy(), np.minimum(o, c))
    return out, steps, {"steps": len(steps), "clipped": int(bad_h.sum() + bad_l.sum()), "fixed_oc": fixed, "disagree": disagree}


def check(symbol: str, interval: int, breaks: list[int]) -> dict:
    df = load_frame(symbol, interval)
    if df is None or df.empty:
        return {"symbol": symbol, "interval": interval, "rows": 0, "sessions": 0, "completeness": None, "bad_ohlc": 0,
                "zero_volume": 0, "off_session": 0, "breaks": breaks, "usable": False, "reason": "no data"}
    o, h, l, c, v = (df[k].to_numpy() for k in ("open", "high", "low", "close", "volume"))
    t = df["time"].to_numpy(dtype=np.int64)
    bad = int(((h < np.maximum(o, c) - 1e-9) | (l > np.minimum(o, c) + 1e-9) | (l <= 0)).sum())
    zero_vol = int((v <= 0).sum())
    day = ist_day(t)
    sessions = int(len(np.unique(day)))
    off = 0
    completeness = 1.0
    if interval < 1440:
        m = ist_minute(t)
        off = int(((m < config.SESSION_OPEN) | (m >= config.SESSION_CLOSE)).sum())
        _, counts = np.unique(day, return_counts=True)
        completeness = float(np.minimum(1.0, counts / expected_bars(interval)).mean())
    reasons = []
    if len(df) < 250:
        reasons.append(f"only {len(df)} bars")
    if interval < 1440 and completeness < 0.9:
        reasons.append(f"completeness {completeness:.2f}")
    if bad > len(df) * 0.001:
        reasons.append(f"{bad} inconsistent OHLC bars")
    return {"symbol": symbol, "interval": interval, "rows": int(len(df)), "sessions": sessions, "completeness": completeness,
            "bad_ohlc": bad, "zero_volume": zero_vol, "off_session": off, "breaks": breaks,
            "usable": not reasons, "reason": "; ".join(reasons) or None}


def run(data_version: str, symbols: list[str]) -> dict:
    rows = []
    usable: dict[int, list[str]] = {i: [] for i in config.INTERVALS}
    for sym in symbols:
        daily = load_frame(sym, 1440)
        br = breaks_from_daily(daily)
        ref = next((iv for iv in (15, 5) if iv in config.INTERVALS), None)
        st = reconcile(load_frame(sym, ref), daily)[2] if ref else {"steps": 0, "disagree": 0.0}
        for interval in config.INTERVALS:
            r = check(sym, interval, br)
            if st["steps"] > MAX_STEPS or st["disagree"] > MAX_DISAGREE:
                r["usable"] = False
                why = f"daily and intraday disagree ({st['steps']} ratio steps, {st['disagree']:.0%} of days off)"
                r["reason"] = "; ".join(x for x in (r["reason"], why) if x)
            rows.append((data_version, sym, interval, r["rows"], r["sessions"], r["completeness"], r["bad_ohlc"],
                         r["zero_volume"], r["off_session"], json.dumps(r["breaks"]), int(r["usable"]), r["reason"]))
            if r["usable"]:
                usable[interval].append(sym)
    db.executemany(
        "INSERT OR REPLACE INTO data_quality(data_version, symbol, interval, rows, sessions, completeness, bad_ohlc, zero_volume, "
        "off_session, breaks, usable, reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    return {i: len(v) for i, v in usable.items()}


def usable(data_version: str, interval: int) -> list[str]:
    with db.tx() as con:
        return [r[0] for r in con.execute(
            "SELECT symbol FROM data_quality WHERE data_version=? AND interval=? AND usable=1 ORDER BY symbol", (data_version, interval))]


def breaks(data_version: str) -> dict[str, list[int]]:
    with db.tx() as con:
        return {r[0]: json.loads(r[1]) for r in con.execute(
            "SELECT symbol, breaks FROM data_quality WHERE data_version=? AND interval=1440", (data_version,))}
