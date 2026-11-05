"""The backtest kernel: one strategy over one series, one position at a time.

Execution rules, the same for every strategy:
  * A signal at bar i's close is filled at bar i+1's OPEN, plus adverse
    slippage. Never at the signal bar's own close.
  * Stop and target are ATR(14) multiples measured at the signal bar.
  * A bar that opens through the stop exits at that open (a gap is a gap),
    not at the stop price.
  * If one bar's range touches both stop and target, the STOP is assumed to
    have hit first — intrabar order is unknowable from OHLC, so the
    conservative reading is taken.
  * A target is a resting limit: filled at the target price, no slippage, and
    no price improvement credited on a favourable gap.
  * Intraday positions are closed at the close of the bar ending 15:15 (or
    the session's last bar). Swing positions carry a time stop.
  * A short-hold position (DNA v2, `hold` = N) is closed at the close of the
    session N sessions after its entry session (the 15:15 bar intraday, the
    daily close on daily bars) unless a stop or target closed it first.
  * A locked bar (high == low, i.e. circuit) fills nothing: entries are
    dropped and exits wait for the next tradable bar.
  * A position still open when the data ends is marked at the last close.
Costs are charged afterwards per trade from the effective-dated schedule: a
round trip opened and closed in the same session pays intraday rates, any
other delivery rates.
"""

from __future__ import annotations

import numpy as np
from numba import njit

from . import config
from .costs import trade_costs
from .series import Series

STOP, STOP_GAP, TARGET, EOD, TIME, OPP, END, CARRY = 1, 2, 3, 4, 5, 6, 7, 8
REASONS = {1: "stop", 2: "stop_gap", 3: "target", 4: "eod", 5: "time", 6: "opposite", 7: "end", 8: "locked_carry"}


@njit(cache=True)
def kernel(o, h, l, c, squareoff, entry_ok, el, es, xl, xs, atr, stop_k, tgt_k, trail_k, time_stop, slip, intraday,
           sord, sess_end, hold):
    n = len(c)
    cap = n // 2 + 2
    e_i = np.empty(cap, np.int64)
    x_i = np.empty(cap, np.int64)
    side = np.empty(cap, np.int8)
    epx = np.empty(cap, np.float64)
    xpx = np.empty(cap, np.float64)
    why = np.empty(cap, np.int8)
    k = 0
    pos = 0
    ent = -1
    entry_px = 0.0
    stop = 0.0
    tgt = np.nan
    best = 0.0
    pend = 0
    pend_sd = 0.0
    pend_td = 0.0
    pend_exit = False
    pend_exit_why = OPP

    for j in range(n):
        locked = h[j] == l[j]

        # 1) a pending market exit fills at this open
        if pos != 0 and pend_exit and not locked:
            e_i[k] = ent
            x_i[k] = j
            side[k] = pos
            epx[k] = entry_px
            xpx[k] = o[j] * (1.0 - slip * pos)
            why[k] = pend_exit_why
            k += 1
            pos = 0
            pend_exit = False

        # 2) a pending entry fills at this open
        if pend != 0:
            if pos == 0 and not locked:
                pos = pend
                ent = j
                entry_px = o[j] * (1.0 + slip * pos)
                stop = entry_px - pos * pend_sd
                tgt = entry_px + pos * pend_td if pend_td > 0 else np.nan
                best = entry_px
            pend = 0

        # 3) manage the open position through this bar
        if pos != 0 and not locked:
            r = 0
            px = 0.0
            if j > ent:
                if pos == 1 and o[j] <= stop:
                    r = STOP_GAP
                    px = o[j] * (1.0 - slip)
                elif pos == -1 and o[j] >= stop:
                    r = STOP_GAP
                    px = o[j] * (1.0 + slip)
                elif not np.isnan(tgt) and ((pos == 1 and o[j] >= tgt) or (pos == -1 and o[j] <= tgt)):
                    r = TARGET
                    px = tgt
            if r == 0:
                hit_s = (l[j] <= stop) if pos == 1 else (h[j] >= stop)
                hit_t = (not np.isnan(tgt)) and ((h[j] >= tgt) if pos == 1 else (l[j] <= tgt))
                if hit_s:
                    r = STOP
                    px = stop * (1.0 - slip * pos)
                elif hit_t:
                    r = TARGET
                    px = tgt
            if r == 0 and intraday and squareoff[j]:
                r = EOD
                px = c[j] * (1.0 - slip * pos)
            if r == 0 and hold >= 0 and sess_end[j] and (sord[j] - sord[ent]) >= hold:
                r = TIME
                px = c[j] * (1.0 - slip * pos)
            if r == 0 and time_stop > 0 and (j - ent + 1) >= time_stop:
                r = TIME
                px = c[j] * (1.0 - slip * pos)
            if r != 0:
                e_i[k] = ent
                x_i[k] = j
                side[k] = pos
                epx[k] = entry_px
                xpx[k] = px
                why[k] = r
                k += 1
                pos = 0
                pend_exit = False
            else:
                if trail_k > 0 and not np.isnan(atr[j]):
                    if pos == 1:
                        if c[j] > best:
                            best = c[j]
                        ns = best - trail_k * atr[j]
                        if ns > stop:
                            stop = ns
                    else:
                        if c[j] < best:
                            best = c[j]
                        ns = best + trail_k * atr[j]
                        if ns < stop:
                            stop = ns
                if (pos == 1 and xl[j]) or (pos == -1 and xs[j]):
                    pend_exit = True
                    pend_exit_why = OPP
        elif pos != 0 and locked and intraday and squareoff[j]:
            pend_exit = True
            pend_exit_why = CARRY

        # 4) a fresh signal at this close queues an entry for the next open
        if pos == 0 and entry_ok[j]:
            lg = el[j]
            sh = es[j]
            sd = 0
            if lg and not sh:
                sd = 1
            elif sh and not lg:
                sd = -1
            if sd != 0 and not np.isnan(atr[j]) and atr[j] > 0:
                pend = sd
                pend_sd = stop_k * atr[j]
                pend_td = tgt_k * atr[j]

    if pos != 0:
        e_i[k] = ent
        x_i[k] = n - 1
        side[k] = pos
        epx[k] = entry_px
        xpx[k] = c[n - 1]
        why[k] = END
        k += 1
    return e_i[:k], x_i[:k], side[:k], epx[:k], xpx[:k], why[:k]


class Trades:
    """Trade-level results for one strategy on one series."""

    __slots__ = ("e_i", "x_i", "side", "entry_px", "exit_px", "reason", "qty", "gross", "costs", "net", "entry_time", "exit_time", "entry_day", "notional")

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)

    def __len__(self) -> int:
        return len(self.net)

    def mask(self, m: np.ndarray) -> "Trades":
        return Trades(**{k: getattr(self, k)[m] for k in self.__slots__})


def stop_atr(d: dict, ic) -> np.ndarray:
    """The ATR a strategy's stops and targets are measured in: its own
    timeframe's, or the last closed DAILY bar's when an intraday-timeframe
    strategy carries positions overnight."""
    if ic.s.interval < 1440 and d["exit"].get("hold"):
        return ic.htf_atr(1440, 14)
    return ic.atr(14)


def run(s: Series, d: dict, signals: tuple, atr: np.ndarray, slippage_bps: float = config.SLIPPAGE_BPS,
        cost_multiplier: float = 1.0, capital: float = config.CAPITAL_PER_TRADE) -> Trades:
    el, es, xl, xs = signals
    ex = d["exit"]
    hold = ex.get("hold")
    intraday = s.interval < 1440 and not hold  # MIS, flat by 15:15
    e_i, x_i, side, epx, xpx, why = kernel(
        s.o, s.h, s.l, s.c, s.sess.squareoff, s.sess.entry_ok, el, es, xl, xs, atr,
        float(ex["stop"]), float(ex["target"]), float(ex["trail"]), int(ex["time"]),
        slippage_bps / 10_000.0, intraday, s.sess.sord, s.sess.sess_end,
        -1 if (hold is None or intraday) else int(hold),
    )
    qty = np.floor(capital / epx).astype(np.int64)
    keep = qty > 0
    if not keep.all():
        e_i, x_i, side, epx, xpx, why, qty = e_i[keep], x_i[keep], side[keep], epx[keep], xpx[keep], why[keep], qty[keep]
    entry_value = epx * qty
    exit_value = xpx * qty
    gross = (xpx - epx) * qty * side
    entry_day = s.sess.day[e_i]
    same_session = s.sess.day[x_i] == entry_day
    costs = trade_costs(entry_value, exit_value, side, entry_day, same_session, multiplier=cost_multiplier)
    return Trades(
        e_i=e_i, x_i=x_i, side=side, entry_px=epx, exit_px=xpx, reason=why, qty=qty,
        gross=gross, costs=costs, net=gross - costs,
        entry_time=s.t[e_i], exit_time=s.t[x_i], entry_day=entry_day, notional=entry_value,
    )
