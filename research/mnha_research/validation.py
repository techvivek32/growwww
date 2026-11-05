"""Statistical validation. The point of this module is to make a lucky
strategy look as unlucky as it really is.

  split_days          chronological train / validation / test boundaries
  portfolio_curve     a capped, capital-constrained equity curve from trades
  walk_forward        per-fold results + the walk-forward test of the
                      *selection procedure* (pick on the past, score on next)
  monte_carlo         bootstrap of the trade sequence → P&L / drawdown bands
  deflated_sharpe     Bailey & López de Prado: Sharpe penalised for the
                      number of strategies tried
  pbo                 probability of backtest overfitting (CSCV)
  bh_fdr              Benjamini–Hochberg false-discovery control
"""

from __future__ import annotations

import datetime as dt
import itertools
import math

import numpy as np
from scipy import stats

from . import config

EULER = 0.5772156649015329


def split_days(days: np.ndarray, split=config.SPLIT) -> tuple[int, int]:
    """(validation_start_day, test_start_day) at the given fractions of the
    distinct trading days."""
    u = np.unique(days)
    if len(u) < 10:
        raise ValueError("too few trading days to split")
    a = u[int(len(u) * split[0])]
    b = u[int(len(u) * (split[0] + split[1]))]
    return int(a), int(b)


def day_to_date(day: int) -> dt.date:
    return dt.date(1970, 1, 1) + dt.timedelta(days=int(day))


# ------------------------------------------------------------ portfolio
def portfolio_curve(entry_t, exit_t, net, symbol_ids, book=config.BOOK_CAPITAL, max_pos=config.MAX_POSITIONS):
    """Take trades in entry order while fewer than `max_pos` are open, each at
    the per-trade notional the engine already used. Returns (taken mask,
    daily equity dict). Deterministic: ties break by symbol id."""
    n = len(net)
    if n == 0:
        return np.zeros(0, dtype=bool), {}
    order = np.lexsort((symbol_ids, entry_t))
    taken = np.zeros(n, dtype=bool)
    open_exits: list[int] = []
    busy: dict[int, int] = {}  # symbol -> exit time of its open position
    for i in order:
        t = entry_t[i]
        open_exits = [x for x in open_exits if x > t]
        if busy.get(int(symbol_ids[i]), -1) > t:
            continue
        if len(open_exits) >= max_pos:
            continue
        taken[i] = True
        open_exits.append(int(exit_t[i]))
        busy[int(symbol_ids[i])] = int(exit_t[i])
    days = ((exit_t[taken] // 1000 + config.IST_OFFSET_S) // 86_400).astype(np.int64)
    pnl = net[taken]
    eq: dict[int, float] = {}
    for d, p in zip(days, pnl):
        eq[int(d)] = eq.get(int(d), 0.0) + float(p)
    return taken, dict(sorted(eq.items()))


def curve_stats(daily_pnl: dict[int, float], book=config.BOOK_CAPITAL) -> dict:
    if not daily_pnl:
        return {"days": 0}
    days = np.array(list(daily_pnl.keys()))
    pnl = np.array(list(daily_pnl.values()))
    equity = book + np.cumsum(pnl)
    peak = np.maximum.accumulate(np.concatenate([[book], equity]))[1:]
    dd = (peak - equity) / peak
    rets = pnl / np.concatenate([[book], equity[:-1]])
    span_years = max((days[-1] - days[0]) / 365.25, 1 / 365.25)
    total = equity[-1] / book - 1
    cagr = (equity[-1] / book) ** (1 / span_years) - 1 if equity[-1] > 0 else -1.0
    sd = rets.std(ddof=1) if len(rets) > 1 else 0.0
    sharpe = float(rets.mean() / sd * math.sqrt(252)) if sd > 0 else None
    monthly: dict[str, float] = {}
    for d, p in zip(days, pnl):
        key = day_to_date(int(d)).strftime("%Y-%m")
        monthly[key] = monthly.get(key, 0.0) + float(p)
    return {
        "days": int(len(days)),
        "total_return": float(total),
        "cagr": float(cagr),
        "max_dd_pct": float(dd.max()),
        "sharpe_daily_ann": sharpe,
        "final_equity": float(equity[-1]),
        "monthly_pnl": monthly,
        "equity": [[int(d), float(e)] for d, e in zip(days, equity)],
    }


# ------------------------------------------------------------ walk forward
def fold_edges(day_lo: int, day_hi: int, k: int) -> list[tuple[int, int]]:
    e = np.linspace(day_lo, day_hi, k + 1).round().astype(int)
    return [(int(e[i]), int(e[i + 1])) for i in range(k)]


def fold_pnl(entry_day: np.ndarray, net: np.ndarray, folds) -> list[float]:
    return [float(net[(entry_day >= a) & (entry_day < b)].sum()) for a, b in folds]


def walk_forward_selection(fold_matrix: np.ndarray, top: int = 10) -> dict:
    """fold_matrix[s, f] = net P&L of strategy s in fold f. For each fold f >= 1,
    choose the `top` strategies by cumulative P&L over folds < f and record
    what they then earned in fold f. This scores the act of selecting on the
    past — the thing a live deployment actually does."""
    S, F = fold_matrix.shape
    out = []
    for f in range(1, F):
        past = fold_matrix[:, :f].sum(axis=1)
        pick = np.argsort(-past, kind="stable")[: min(top, S)]
        out.append({
            "fold": f,
            "picked_oos_mean": float(fold_matrix[pick, f].mean()),
            "all_oos_mean": float(fold_matrix[:, f].mean()),
            "picked_oos_positive": float((fold_matrix[pick, f] > 0).mean()),
        })
    return {"folds": out, "picked_beat_all": float(np.mean([o["picked_oos_mean"] > o["all_oos_mean"] for o in out])) if out else None}


# ------------------------------------------------------------ monte carlo
def monte_carlo(net: np.ndarray, n_sims: int = 1000, seed: int = config.SEED) -> dict:
    """Resample trades with replacement (same count) → distribution of total
    P&L and max drawdown. Seeded, so the same trades give the same bands."""
    if len(net) < 5:
        return {"sims": 0}
    rng = np.random.default_rng(seed)
    n = len(net)
    batch = max(1, min(n_sims, 4_000_000 // n))  # bound memory on long trade lists
    totals = np.empty(n_sims)
    dds = np.empty(n_sims)
    for b0 in range(0, n_sims, batch):
        k = min(batch, n_sims - b0)
        paths = np.cumsum(net[rng.integers(0, n, size=(k, n))], axis=1)
        totals[b0 : b0 + k] = paths[:, -1]
        peaks = np.maximum(np.maximum.accumulate(paths, axis=1), 0.0)
        dds[b0 : b0 + k] = (peaks - paths).max(axis=1)
    return {
        "sims": n_sims,
        "total_p5": float(np.percentile(totals, 5)),
        "total_p50": float(np.percentile(totals, 50)),
        "total_p95": float(np.percentile(totals, 95)),
        "max_dd_p50": float(np.percentile(dds, 50)),
        "max_dd_p95": float(np.percentile(dds, 95)),
        "prob_loss": float((totals <= 0).mean()),
    }


# ------------------------------------------------------------ deflated sharpe
def expected_max_sharpe(n_trials: int, sr_var: float) -> float:
    """Expected maximum Sharpe among n_trials of zero-skill strategies."""
    if n_trials < 2 or sr_var <= 0:
        return 0.0
    z1 = stats.norm.ppf(1 - 1.0 / n_trials)
    z2 = stats.norm.ppf(1 - 1.0 / (n_trials * math.e))
    return math.sqrt(sr_var) * ((1 - EULER) * z1 + EULER * z2)


def deflated_sharpe_from_moments(sr: float | None, T: int, skew: float | None, kurt: float | None, n_trials: int, sr_var: float) -> dict:
    if sr is None or T < 10 or skew is None or kurt is None:
        return {"dsr": None, "sr": sr, "sr0": None, "T": T}
    sr0 = expected_max_sharpe(n_trials, sr_var)
    denom = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    z = (sr - sr0) * math.sqrt(T - 1) / denom
    return {"dsr": float(stats.norm.cdf(z)), "sr": float(sr), "sr0": float(sr0), "T": int(T), "skew": float(skew), "kurt": float(kurt)}


def deflated_sharpe(returns: np.ndarray, n_trials: int, sr_var: float) -> dict:
    """Probability the strategy's true (per-trade) Sharpe exceeds what the best
    of `n_trials` lucky strategies would show."""
    r = np.asarray(returns, dtype=float)
    T = len(r)
    if T < 10 or r.std(ddof=1) == 0:
        return {"dsr": None, "sr": None, "sr0": None, "T": T}
    sr = r.mean() / r.std(ddof=1)
    return deflated_sharpe_from_moments(float(sr), T, float(stats.skew(r)), float(stats.kurtosis(r, fisher=False)), n_trials, sr_var)


# ------------------------------------------------------------ PBO (CSCV)
def pbo(perf: np.ndarray, n_blocks: int = 10) -> dict:
    """perf[t, s]: strategy s's P&L in period t. Split periods into n_blocks;
    for every half/half combination pick the best in-sample strategy and see
    where it ranks out of sample. PBO = share of splits where the in-sample
    winner lands below the out-of-sample median."""
    T, S = perf.shape
    if S < 2 or T < n_blocks:
        return {"pbo": None, "splits": 0}
    blocks = np.array_split(np.arange(T), n_blocks)
    logits = []
    for combo in itertools.combinations(range(n_blocks), n_blocks // 2):
        is_idx = np.concatenate([blocks[i] for i in combo])
        oos_idx = np.concatenate([blocks[i] for i in range(n_blocks) if i not in combo])
        is_perf = perf[is_idx].sum(axis=0)
        oos_perf = perf[oos_idx].sum(axis=0)
        best = int(np.argmax(is_perf))
        rank = stats.rankdata(oos_perf)[best] / (S + 1)
        logits.append(math.log(rank / (1 - rank)))
    logits = np.array(logits)
    return {"pbo": float((logits <= 0).mean()), "splits": int(len(logits)), "logit_median": float(np.median(logits))}


# ------------------------------------------------------------ FDR
def t_pvalue(returns: np.ndarray) -> float:
    """One-sided p-value that the mean trade return is > 0."""
    r = np.asarray(returns, dtype=float)
    if len(r) < 3 or r.std(ddof=1) == 0:
        return 1.0
    t = r.mean() / (r.std(ddof=1) / math.sqrt(len(r)))
    return float(stats.t.sf(t, df=len(r) - 1))


def bh_fdr(pvalues: np.ndarray, q: float = 0.10) -> np.ndarray:
    """Benjamini–Hochberg: boolean mask of discoveries at FDR level q."""
    p = np.asarray(pvalues, dtype=float)
    m = len(p)
    if m == 0:
        return np.zeros(0, dtype=bool)
    order = np.argsort(p)
    thresh = q * (np.arange(1, m + 1) / m)
    passed = p[order] <= thresh
    out = np.zeros(m, dtype=bool)
    if passed.any():
        kmax = np.max(np.nonzero(passed)[0])
        out[order[: kmax + 1]] = True
    return out
