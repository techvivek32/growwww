"""NSE session arithmetic on bar-open timestamps (epoch ms).

Everything is computed in IST explicitly, so the server's own timezone never
matters. A bar's *close* time is its open plus the interval, capped at the
session close — the last 60-minute bar of the day (15:15) closes at 15:30,
not 16:15. Higher-timeframe values are aligned to a lower-timeframe bar only
once the higher bar has closed.
"""

from __future__ import annotations

import numpy as np

from . import config

DAY_S = 86_400


def ist_day(t_ms: np.ndarray) -> np.ndarray:
    """IST calendar day number (days since epoch) of each bar."""
    return ((t_ms // 1000 + config.IST_OFFSET_S) // DAY_S).astype(np.int64)


def ist_minute(t_ms: np.ndarray) -> np.ndarray:
    """IST minutes from midnight of each bar's open."""
    return (((t_ms // 1000 + config.IST_OFFSET_S) % DAY_S) // 60).astype(np.int64)


def close_times(t_ms: np.ndarray, interval: int) -> np.ndarray:
    """Epoch ms at which each bar is final."""
    day = ist_day(t_ms)
    session_close_ms = (day * DAY_S + config.SESSION_CLOSE * 60 - config.IST_OFFSET_S) * 1000
    if interval >= 1440:
        return session_close_ms
    return np.minimum(t_ms + interval * 60_000, session_close_ms)


def align(ltf_close: np.ndarray, htf_close: np.ndarray, htf_values: np.ndarray) -> np.ndarray:
    """For each lower-timeframe bar, the latest higher-timeframe value whose bar
    had closed by then; NaN before the first closed higher bar."""
    idx = np.searchsorted(htf_close, ltf_close, side="right") - 1
    out = np.full(len(ltf_close), np.nan)
    ok = idx >= 0
    out[ok] = htf_values[idx[ok]]
    return out


class SessionInfo:
    """Per-bar session facts the engine needs."""

    def __init__(self, t_ms: np.ndarray, interval: int):
        self.interval = interval
        self.day = ist_day(t_ms)
        self.minute = ist_minute(t_ms)
        n = len(t_ms)
        nxt_same = np.zeros(n, dtype=np.bool_)
        if n > 1:
            nxt_same[:-1] = self.day[1:] == self.day[:-1]
        self.next_same_day = nxt_same
        # session ordinal of each bar (0, 0, ..., 1, 1, ...), for "held N sessions"
        new_day = np.ones(n, dtype=np.bool_)
        if n > 1:
            new_day[1:] = self.day[1:] != self.day[:-1]
        self.sord = np.cumsum(new_day).astype(np.int64) - 1
        if interval >= 1440:
            # Swing: every bar is its own session; entries go to the next day's open.
            self.squareoff = np.zeros(n, dtype=np.bool_)
            ok = np.zeros(n, dtype=np.bool_)
            ok[:-1] = True
            self.entry_ok = ok
            self.intraday = False
            self.sess_end = np.ones(n, dtype=np.bool_)
        else:
            end = self.minute + interval
            # Flat by 15:15: on the bar that ends at/after it, on the bar after
            # which the next one would end past it, or on the session's last bar.
            nxt_end = np.full(n, 10**6)
            nxt_end[:-1] = end[1:]
            self.squareoff = (end >= config.SQUAREOFF) | (nxt_same & (nxt_end > config.SQUAREOFF)) | ~nxt_same
            ok = np.zeros(n, dtype=np.bool_)
            if n > 1:
                nm = self.minute[1:]
                ok[:-1] = nxt_same[:-1] & (nm <= config.LAST_ENTRY) & ~self.squareoff[1:] & ~self.squareoff[:-1]
            self.entry_ok = ok
            self.intraday = True
            # where a carried position's holding period ends: the square-off bar
            self.sess_end = self.squareoff.copy()
