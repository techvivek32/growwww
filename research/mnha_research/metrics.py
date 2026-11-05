"""Metrics from trades. All P&L is net of charges and slippage unless named
gross. Returns are per trade, on the position's own notional.

AggTable accumulates additive sums for many strategies at once, so a
strategy's metrics can be built symbol by symbol without holding every trade
in memory, and checkpointed as a single .npz.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from scipy import stats

FIELDS = ("trades", "wins", "gp", "gl", "costs", "net", "r1", "r2", "r3", "r4", "bars", "symbols", "last_sym")


class AggTable:
    def __init__(self, m: int):
        self.m = m
        for f in FIELDS:
            setattr(self, f, np.zeros(m, dtype=np.float64))
        self.last_sym[:] = -1

    def add(self, k: int, net: np.ndarray, costs: np.ndarray, notional: np.ndarray, bars: np.ndarray, sym_id: int) -> None:
        if len(net) == 0:
            return
        r = net / notional
        self.trades[k] += len(net)
        self.wins[k] += (net > 0).sum()
        self.gp[k] += net[net > 0].sum()
        self.gl[k] += -net[net <= 0].sum()
        self.costs[k] += costs.sum()
        self.net[k] += net.sum()
        self.r1[k] += r.sum()
        r2 = r * r
        self.r2[k] += r2.sum()
        self.r3[k] += (r2 * r).sum()
        self.r4[k] += (r2 * r2).sum()
        self.bars[k] += bars.sum()
        if self.last_sym[k] != sym_id:
            self.symbols[k] += 1
            self.last_sym[k] = sym_id

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp.npz")
        np.savez(tmp, **{f: getattr(self, f) for f in FIELDS})
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path, m: int) -> "AggTable":
        t = cls(m)
        z = np.load(path)
        for f in FIELDS:
            setattr(t, f, z[f].copy())
        return t

    def moments(self, k: int) -> tuple[float | None, float | None, float | None, float | None]:
        """(mean, sd, skew, kurtosis[non-excess]) of per-trade returns."""
        n = self.trades[k]
        if n < 3:
            return None, None, None, None
        m1 = self.r1[k] / n
        m2 = self.r2[k] / n - m1**2
        if m2 <= 0:
            return m1, None, None, None
        m3 = self.r3[k] / n - 3 * m1 * self.r2[k] / n + 2 * m1**3
        m4 = self.r4[k] / n - 4 * m1 * self.r3[k] / n + 6 * m1**2 * self.r2[k] / n - 3 * m1**4
        sd = math.sqrt(m2 * n / (n - 1))
        return m1, sd, m3 / m2**1.5, m4 / m2**2

    def row(self, k: int) -> dict:
        n = int(self.trades[k])
        mean, sd, _, _ = self.moments(k)
        sharpe = mean / sd if (sd and mean is not None) else None
        return {
            "trades": n,
            "wins": int(self.wins[k]),
            "gross_profit": float(self.gp[k]),
            "gross_loss": float(self.gl[k]),
            "costs": float(self.costs[k]),
            "net_pnl": float(self.net[k]),
            "profit_factor": float(self.gp[k] / self.gl[k]) if self.gl[k] > 0 else None,
            "win_rate": float(self.wins[k] / n) if n else None,
            "expectancy": float(self.net[k] / n) if n else None,
            "sharpe": sharpe,
            "t_stat": sharpe * math.sqrt(n) if sharpe is not None else None,
            "max_dd": None,
            "avg_hold_bars": float(self.bars[k] / n) if n else None,
            "symbols": int(self.symbols[k]),
        }

    def pvalue(self, k: int) -> float:
        n = int(self.trades[k])
        mean, sd, _, _ = self.moments(k)
        if not sd or mean is None:
            return 1.0
        return float(stats.t.sf(mean / sd * math.sqrt(n), df=n - 1))


def max_drawdown(pnl_in_time_order: np.ndarray) -> float:
    """Worst peak-to-trough fall of the cumulative P&L, in ₹ (positive number)."""
    if len(pnl_in_time_order) == 0:
        return 0.0
    eq = np.concatenate([[0.0], np.cumsum(pnl_in_time_order)])
    return float((np.maximum.accumulate(eq) - eq).max())


def summary(net, costs, notional, bars, exit_time, symbols) -> dict:
    t = AggTable(1)
    t.add(0, net, costs, notional, bars, 0)
    row = t.row(0)
    row["symbols"] = int(symbols)
    order = np.argsort(exit_time, kind="stable")
    row["max_dd"] = max_drawdown(net[order])
    return row
