"""A candle series plus a lazy indicator cache.

The cache is per (symbol, interval, slice): every strategy that asks for
EMA(50) on the same series gets the same array, computed once. Entry triggers
and filter masks are cached too — thousands of strategy variants share them.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd

from . import config
from . import indicators as ind
from .sessions import SessionInfo, align, close_times


class Series:
    def __init__(self, symbol: str, interval: int, df: pd.DataFrame):
        self.symbol = symbol
        self.interval = interval
        self.t = df["time"].to_numpy(dtype=np.int64)
        self.o = df["open"].to_numpy(dtype=np.float64)
        self.h = df["high"].to_numpy(dtype=np.float64)
        self.l = df["low"].to_numpy(dtype=np.float64)
        self.c = df["close"].to_numpy(dtype=np.float64)
        self.v = df["volume"].to_numpy(dtype=np.float64)
        self.close_t = close_times(self.t, interval)
        self.sess = SessionInfo(self.t, interval)
        # Set by the pipeline when known: bool per bar, the stock had F&O that
        # day (entries only then); and (sorted IST days, delivery share) from NSE.
        self.member: np.ndarray | None = None
        self.deliv: tuple[np.ndarray, np.ndarray] | None = None

    def __len__(self) -> int:
        return len(self.t)

    @property
    def day(self) -> np.ndarray:
        return self.sess.day


def load_frame(symbol: str, interval: int) -> pd.DataFrame | None:
    path = config.CANDLES / str(interval) / f"{symbol}.parquet"
    if not path.exists():
        return None
    df = pd.read_parquet(path)
    return df.sort_values("time").drop_duplicates("time").reset_index(drop=True)


def cut(df: pd.DataFrame, interval: int, day_from: int | None = None, day_to: int | None = None) -> pd.DataFrame:
    """Rows whose IST day is in [day_from, day_to)."""
    from .sessions import ist_day

    d = ist_day(df["time"].to_numpy(dtype=np.int64))
    m = np.ones(len(df), dtype=bool)
    if day_from is not None:
        m &= d >= day_from
    if day_to is not None:
        m &= d < day_to
    return df.loc[m].reset_index(drop=True)


HtfLoader = Callable[[int], "Series | None"]


class Cache:
    """Lazy indicators over one Series. `htf_loader(interval)` returns the same
    symbol's higher-timeframe Series (already cut to the same day range)."""

    def __init__(self, s: Series, htf_loader: HtfLoader | None = None):
        self.s = s
        self._htf_loader = htf_loader
        self._d: dict[tuple, np.ndarray] = {}
        self.triggers: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self.filters: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    def _get(self, key: tuple, fn):
        v = self._d.get(key)
        if v is None:
            v = fn()
            self._d[key] = v
        return v

    def ema(self, n: int):
        return self._get(("ema", n), lambda: ind.ema(self.s.c, n))

    def sma(self, n: int):
        return self._get(("sma", n), lambda: ind.sma(self.s.c, n))

    def std(self, n: int):
        return self._get(("std", n), lambda: ind.rolling_std(self.s.c, n))

    def rsi(self, n: int):
        return self._get(("rsi", n), lambda: ind.rsi(self.s.c, n))

    def atr(self, n: int = 14):
        return self._get(("atr", n), lambda: ind.atr(self.s.h, self.s.l, self.s.c, n))

    def tr(self):
        return self._get(("tr",), lambda: ind.true_range(self.s.h, self.s.l, self.s.c))

    def adx(self, n: int = 14):
        return self._get(("adx", n), lambda: ind.adx(self.s.h, self.s.l, self.s.c, n))

    def macd(self, fast: int, slow: int, sig: int):
        def f():
            line = self.ema(fast) - self.ema(slow)
            return line, ind.ema(line, sig)

        return self._get(("macd", fast, slow, sig), f)

    def supertrend(self, n: int, mult: float):
        return self._get(("st", n, mult), lambda: ind.supertrend_dir(self.s.h, self.s.l, self.s.c, n, mult))

    def prior_high(self, n: int):
        return self._get(("phi", n), lambda: ind.prior_max(self.s.h, n))

    def prior_low(self, n: int):
        return self._get(("plo", n), lambda: ind.prior_min(self.s.l, n))

    def relvol(self, n: int = 20):
        def f():
            pm = ind.prior_mean(self.s.v, n)
            with np.errstate(divide="ignore", invalid="ignore"):
                return np.where(pm > 0, self.s.v / pm, np.nan)

        return self._get(("rv", n), f)

    def vwap(self):
        return self._get(("vwap",), lambda: ind.session_vwap(self.s.h, self.s.l, self.s.c, self.s.v, self.s.day))

    def prev_day_hl(self):
        return self._get(("pdhl",), lambda: ind.prev_session_hl(self.s.h, self.s.l, self.s.day))

    def opening_range(self, window: int):
        return self._get(("orb", window), lambda: ind.opening_range(
            self.s.h, self.s.l, self.s.sess.minute, self.s.day, config.SESSION_OPEN, window, self.s.interval))

    def bands(self, n: int, k: float):
        def f():
            mid, sd = self.sma(n), self.std(n)
            return mid - k * sd, mid, mid + k * sd

        return self._get(("bb", n, k), f)

    def htf_trend(self, htf: int, n: int) -> np.ndarray:
        """+1 where the last CLOSED higher-timeframe bar closed above its EMA(n),
        -1 below, NaN before it is known."""

        def f():
            hs = self._htf_loader(htf) if self._htf_loader else None
            if hs is None or len(hs) == 0:
                return np.full(len(self.s), np.nan)
            e = ind.ema(hs.c, n)
            with np.errstate(invalid="ignore"):
                sign = np.where(np.isnan(e), np.nan, np.sign(hs.c - e))
            return align(self.s.close_t, hs.close_t, sign)

        return self._get(("htf", htf, n), f)

    def htf_atr(self, htf: int, n: int = 14) -> np.ndarray:
        """ATR(n) of the last CLOSED higher-timeframe bar; NaN before it is known."""

        def f():
            hs = self._htf_loader(htf) if self._htf_loader else None
            if hs is None or len(hs) == 0:
                return np.full(len(self.s), np.nan)
            return align(self.s.close_t, hs.close_t, ind.atr(hs.h, hs.l, hs.c, n))

        return self._get(("htf_atr", htf, n), f)

    def delivery(self) -> tuple[np.ndarray, np.ndarray]:
        """(delivery share of traded quantity, its ratio to the mean of the 20
        sessions before) as known when each bar closes. A daily bar sees its
        own session (NSE publishes it after the close; the fill is the next
        open); an intraday bar sees the session before. NaN when unknown or
        more than a week stale."""

        def f():
            n = len(self.s)
            if self.s.deliv is None or len(self.s.deliv[0]) == 0:
                return np.full(n, np.nan), np.full(n, np.nan)
            dd, share = self.s.deliv
            pm = ind.prior_mean(share, 20)
            with np.errstate(divide="ignore", invalid="ignore"):
                rel = np.where(pm > 0, share / pm, np.nan)
            side = "right" if self.s.interval >= 1440 else "left"
            idx = np.searchsorted(dd, self.s.day, side=side) - 1
            ok = idx >= 0
            ok[ok] &= (self.s.day[ok] - dd[idx[ok]]) <= 7
            a, b = np.full(n, np.nan), np.full(n, np.nan)
            a[ok], b[ok] = share[idx[ok]], rel[idx[ok]]
            return a, b

        return self._get(("deliv",), f)
