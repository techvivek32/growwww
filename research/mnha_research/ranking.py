"""Strategy ranking: gates first, score second.

A strategy is ELIGIBLE only if it clears every gate — a high score never buys
back a failed gate. Gates and score use train + validation evidence only. The
TEST period is shown beside the rank and decides the final status label, but
it never changes the order: the board is not tuned on its own exam.

Score (each component percentile-normalised across the evaluated set):
  25%  out-of-sample profitability   validation net expectancy per trade, % of notional
  20%  risk-adjusted return          portfolio Sharpe (train+validation)
  20%  drawdown                      portfolio max drawdown (lower is better)
  15%  profit factor                 validation
  10%  consistency                   share of walk-forward folds and years in profit
  10%  statistical reliability       deflated Sharpe (penalised for 100,000 trials)
"""

from __future__ import annotations

import json

import numpy as np
from scipy import stats

from . import config, db

WEIGHTS = {"oos_profit": 0.25, "risk_adjusted": 0.20, "drawdown": 0.20, "profit_factor": 0.15, "consistency": 0.10, "reliability": 0.10}

GATES = {
    "validation_trades>=30": lambda x: (x["val_trades"] or 0) >= 30,
    "validation_net>0": lambda x: (x["val_net"] or 0) > 0,
    "validation_pf>=1.05": lambda x: (x["val_pf"] or 0) >= 1.05,
    "walk_forward_folds>=50%": lambda x: (x["wf_pos"] or 0) >= 0.5,
    "net_after_cost_x2>0": lambda x: (x["cost2x"] or -1) > 0,
    "portfolio_max_dd<=30%": lambda x: x["port_dd"] is not None and x["port_dd"] <= 0.30,
    "neighbours_profitable>=50%": lambda x: x["stab"] is not None and x["stab"] >= 0.5,
    "fdr_q10": lambda x: bool(x["fdr"]),
}


def _pct(v: np.ndarray, higher_better: bool = True) -> np.ndarray:
    out = np.full(len(v), 0.0)
    ok = ~np.isnan(v)
    if ok.sum() == 0:
        return out
    r = stats.rankdata(v[ok] if higher_better else -v[ok]) / ok.sum()
    out[ok] = r
    return out


def rank(run_id: int, deep_run: int, validate_run: int) -> dict:
    with db.tx() as con:
        hashes = [r[0] for r in con.execute(
            "SELECT DISTINCT strategy_hash FROM strategy_metrics WHERE run_id=? AND segment='trainval'", (deep_run,))]
        met = {(r["strategy_hash"], r["segment"]): dict(r) for r in con.execute(
            "SELECT * FROM strategy_metrics WHERE run_id=? AND segment IN ('validation','test','trainval')", (deep_run,))}
        val = {}
        for r in con.execute("SELECT strategy_hash, test, value FROM validation_results WHERE run_id IN (?, ?)", (deep_run, validate_run)):
            val[(r[0], r[1])] = json.loads(r[2])
    if not hashes:
        return {"ranked": 0, "eligible": 0}

    rows = []
    for h in hashes:
        v, t = met.get((h, "validation"), {}), met.get((h, "test"), {})
        port = val.get((h, "portfolio"), {})
        years = val.get((h, "by_year"), {})
        tv_years = [y["net"] for y in years.values() if y["segments"] != ["test"]]
        wf = val.get((h, "walk_forward"), {})
        x = {
            "hash": h,
            "val_trades": v.get("trades"), "val_net": v.get("net_pnl"), "val_pf": v.get("profit_factor"),
            "val_exp_pct": (v["net_pnl"] / v["trades"] / config.CAPITAL_PER_TRADE * 100) if v.get("trades") else None,
            "wf_pos": wf.get("positive_frac"),
            "years_pos": float(np.mean([n > 0 for n in tv_years])) if tv_years else None,
            "cost2x": val.get((h, "cost_x2"), {}).get("net"),
            "port_dd": port.get("max_dd_pct"), "port_sharpe": port.get("sharpe_daily_ann"),
            "stab": val.get((h, "stability"), {}).get("profitable_frac"),
            "dsr": val.get((h, "dsr"), {}).get("dsr"),
            "fdr": val.get((h, "fdr"), {}).get("pass"),
            "test_net": t.get("net_pnl"), "test_pf": t.get("profit_factor"), "test_trades": t.get("trades"),
        }
        x["gates"] = {name: bool(fn(x)) for name, fn in GATES.items()}
        x["eligible"] = all(x["gates"].values())
        rows.append(x)

    f = lambda key: np.array([np.nan if r[key] is None else float(r[key]) for r in rows])  # noqa: E731
    cons = np.nanmean(np.vstack([f("wf_pos"), f("years_pos")]), axis=0)
    comp = {
        "oos_profit": _pct(f("val_exp_pct")),
        "risk_adjusted": _pct(f("port_sharpe")),
        "drawdown": _pct(f("port_dd"), higher_better=False),
        "profit_factor": _pct(f("val_pf")),
        "consistency": _pct(cons),
        "reliability": _pct(f("dsr")),
    }
    score = sum(WEIGHTS[k] * comp[k] for k in WEIGHTS)
    order = sorted(range(len(rows)), key=lambda i: (not rows[i]["eligible"], -score[i]))
    out_rows = []
    for rank_, i in enumerate(order, start=1):
        x = rows[i]
        if not x["eligible"]:
            status = "ineligible"
        elif (x["test_net"] or 0) > 0 and (x["test_pf"] or 0) > 1.0:
            status = "validated"
        else:
            status = "failed_holdout"
        components = {k: float(comp[k][i]) for k in WEIGHTS}
        components.update({"raw": {k: x[k] for k in ("val_exp_pct", "port_sharpe", "port_dd", "val_pf", "wf_pos", "years_pos", "dsr",
                                                     "cost2x", "stab", "test_net", "test_pf", "test_trades")}})
        out_rows.append((run_id, x["hash"], rank_, float(score[i]), int(x["eligible"]), status, json.dumps(x["gates"]), json.dumps(components)))
    db.executemany(
        "INSERT OR REPLACE INTO strategy_rankings(run_id, strategy_hash, rank, score, eligible, status, gates, components) VALUES(?,?,?,?,?,?,?,?)",
        out_rows,
    )
    statuses = [r[5] for r in out_rows]
    gate_fail = {g: int(sum(not r["gates"][g] for r in rows)) for g in GATES}
    return {"ranked": len(rows), "eligible": int(sum(r["eligible"] for r in rows)), "validated": statuses.count("validated"),
            "failed_holdout": statuses.count("failed_holdout"), "gate_failures": gate_fail}
