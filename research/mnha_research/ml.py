"""The trained model: a meta-label classifier.

Rather than predicting prices, it answers a narrower question that can be
tested honestly: given that a validated strategy has just fired, with the
market looking like *this*, is the trade more likely to end in profit after
costs? If it can tell, filtering the strategies' signals through it should
raise net P&L per trade on data it never saw.

Protocol (chronological, no shuffling):
  fit         trades from the TRAIN segment
  tune        decision threshold chosen on the VALIDATION segment
  report      untouched TEST segment: filtered vs unfiltered net P&L
Train trades whose exit falls inside validation are dropped (purge), so no
label leaks across the boundary. A logistic-regression baseline is trained on
the same data; the boosted model has to beat it to mean anything.
"""

from __future__ import annotations

import json
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config, db
from . import indicators as ind
from .dna import SHORT_FAMILIES as FAMILIES  # v1 families first, so their codes are unchanged
from .series import Cache, Series
from .sessions import align

MARKET_FEATURES = [
    "rsi14", "adx14", "atr_pct", "relvol20", "dist_ema20", "dist_ema50", "dist_ema200",
    "roc5", "roc20", "bb_pctb", "minute", "dow", "gap_pct", "nifty_bull", "nifty_volhi", "nifty_roc20", "nifty_atr_pct",
]
STRATEGY_FEATURES = ["family", "tf", "side", "stop_k", "target_k", "trail_k", "opp", "hold"]
FEATURES = MARKET_FEATURES + STRATEGY_FEATURES


class Nifty:
    """NIFTY daily regime arrays, aligned on demand to any series by bar close."""

    def __init__(self, s: Series | None):
        self.s = s
        if s is None:
            return
        c = s.c
        e200 = ind.ema(c, 200)
        a = ind.atr(s.h, s.l, c, 14)
        with np.errstate(invalid="ignore", divide="ignore"):
            atr_pct = a / c
            self.bull = np.where(np.isnan(e200), np.nan, (c > e200).astype(float))
            avg = ind.sma(atr_pct, 250)
            self.volhi = np.where(np.isnan(avg), np.nan, (atr_pct > avg).astype(float))
            roc = np.full(len(c), np.nan)
            roc[20:] = c[20:] / c[:-20] - 1
        self.roc20 = roc
        self.atr_pct = atr_pct

    def at(self, target: Series) -> dict[str, np.ndarray]:
        n = len(target)
        if self.s is None:
            return {k: np.full(n, np.nan) for k in ("nifty_bull", "nifty_volhi", "nifty_roc20", "nifty_atr_pct")}
        ct = self.s.close_t
        return {
            "nifty_bull": align(target.close_t, ct, self.bull),
            "nifty_volhi": align(target.close_t, ct, self.volhi),
            "nifty_roc20": align(target.close_t, ct, self.roc20),
            "nifty_atr_pct": align(target.close_t, ct, self.atr_pct),
        }


def piece_features(ic: Cache, nifty: Nifty) -> dict[str, np.ndarray]:
    """Market features at every bar of a piece (value at bar i uses bars <= i)."""
    s = ic.s
    c = s.c
    n = len(c)
    a = ic.atr(14)
    lo, _mid, up = ic.bands(20, 2.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        roc5 = np.full(n, np.nan)
        roc5[5:] = (c[5:] - c[:-5]) / a[5:]
        roc20 = np.full(n, np.nan)
        roc20[20:] = (c[20:] - c[:-20]) / a[20:]
        first = np.ones(n, dtype=bool)
        first[1:] = s.day[1:] != s.day[:-1]
        prev_close = ind.shift(c, 1)
        day_open = np.where(first, s.o, np.nan)
        # carry each session's opening gap through the session
        gap = np.where(first, day_open / prev_close - 1, np.nan)
        idx = np.where(first, np.arange(n), 0)
        np.maximum.accumulate(idx, out=idx)
        gap = gap[idx]
        f = {
            "rsi14": ic.rsi(14),
            "adx14": ic.adx(14)[2],
            "atr_pct": a / c,
            "relvol20": ic.relvol(20),
            "dist_ema20": (c - ic.ema(20)) / a,
            "dist_ema50": (c - ic.ema(50)) / a,
            "dist_ema200": (c - ic.ema(200)) / a,
            "roc5": roc5,
            "roc20": roc20,
            "bb_pctb": (c - lo) / (up - lo),
            "minute": s.sess.minute.astype(float) if s.interval < 1440 else np.full(n, -1.0),
            "dow": ((s.day + 3) % 7).astype(float),
            "gap_pct": gap,
        }
    f.update(nifty.at(s))
    return f


def strategy_features(d: dict) -> dict[str, float]:
    return {
        "family": float(FAMILIES.index(d["family"])),
        "tf": float(d["tf"]),
        "side": {"long": 1.0, "short": -1.0, "both": 0.0}[d["side"]],
        "stop_k": float(d["exit"]["stop"]),
        "target_k": float(d["exit"]["target"]),
        "trail_k": float(d["exit"]["trail"]),
        "opp": float(d["exit"]["opp"]),
        "hold": float(d["exit"].get("hold", -1)),
    }


def _economics(net: np.ndarray, keep: np.ndarray) -> dict:
    def stats_(x):
        gp, gl = x[x > 0].sum(), -x[x <= 0].sum()
        return {"trades": int(len(x)), "net": float(x.sum()), "per_trade": float(x.mean()) if len(x) else None,
                "pf": float(gp / gl) if gl > 0 else None, "win_rate": float((x > 0).mean()) if len(x) else None}

    return {"all": stats_(net), "model_kept": stats_(net[keep]), "kept_share": float(keep.mean()) if len(keep) else None}


def train(run_id: int, dataset_dir, seed: int = config.SEED) -> dict:
    files = sorted(dataset_dir.glob("*.parquet"))
    if not files:
        raise RuntimeError("no ML dataset — run the validate stage first")
    codes: dict[str, int] = {}

    def load(f):
        d = pd.read_parquet(f, columns=FEATURES + ["strategy_hash", "segment", "entry_time", "exit_time", "net"])
        d["strategy_hash"] = d["strategy_hash"].map(lambda h: codes.setdefault(h, len(codes))).astype(np.int32)
        d["segment"] = d["segment"].astype("category")
        return d

    df = pd.concat([load(f) for f in files], ignore_index=True)
    df["segment"] = df["segment"].astype(str)
    df = df.sort_values("entry_time", kind="stable").reset_index(drop=True)
    # Cap per strategy so a few prolific strategies do not dominate the fit.
    rng = np.random.default_rng(seed)
    df["_r"] = rng.random(len(df))
    keep = df.groupby("strategy_hash")["_r"].rank(method="first") <= 3000
    df = df[keep].drop(columns="_r").reset_index(drop=True)

    tr = df[df.segment == "train"]
    va = df[df.segment == "validation"]
    te = df[df.segment == "test"]
    if len(va):
        tr = tr[tr.exit_time < va.entry_time.min()]  # purge labels that overlap validation
    if len(tr) < 500 or len(va) < 200:
        raise RuntimeError(f"not enough trades to train honestly (train {len(tr)}, validation {len(va)})")

    # A feature with no observed value in training (e.g. a regime needing more
    # index history than exists) cannot be learned from; drop it, and say so.
    feats = [f for f in FEATURES if tr[f].notna().any() and tr[f].nunique(dropna=True) > 1]
    dropped = [f for f in FEATURES if f not in feats]
    X = lambda d: d[feats].to_numpy(dtype=np.float32)  # noqa: E731
    y = lambda d: (d["net"] > 0).to_numpy(dtype=np.int8)  # noqa: E731
    gbm = HistGradientBoostingClassifier(
        max_depth=4, learning_rate=0.05, max_iter=400, l2_regularization=1.0, min_samples_leaf=200,
        categorical_features=[feats.index("family")] if "family" in feats else None, early_stopping=True,
        validation_fraction=0.15, n_iter_no_change=30, random_state=seed,
    )
    t0 = time.time()
    gbm.fit(X(tr), y(tr))
    base = make_pipeline(StandardScaler(), LogisticRegression(max_iter=500))
    base.fit(np.nan_to_num(X(tr)), y(tr))

    def auc(model, d, nan0=False):
        if len(d) < 50 or len(np.unique(y(d))) < 2:
            return None
        xx = np.nan_to_num(X(d)) if nan0 else X(d)
        return float(roc_auc_score(y(d), model.predict_proba(xx)[:, 1]))

    # Threshold: maximise validation net P&L while keeping at least 30% of trades.
    pv = gbm.predict_proba(X(va))[:, 1]
    best_t, best_net = 0.0, float(va["net"].sum())
    for t in np.quantile(pv, np.linspace(0.0, 0.7, 36)):
        keep = pv >= t
        if keep.mean() < 0.3:
            continue
        net = float(va["net"].to_numpy()[keep].sum())
        if net > best_net:
            best_t, best_net = float(t), net

    result = {
        "rows": {"train": int(len(tr)), "validation": int(len(va)), "test": int(len(te))},
        "features": feats,
        "dropped_features": dropped,
        "auc": {"gbm_validation": auc(gbm, va), "gbm_test": auc(gbm, te), "logit_validation": auc(base, va, True), "logit_test": auc(base, te, True)},
        "threshold": best_t,
        "validation": _economics(va["net"].to_numpy(), pv >= best_t),
        "iterations": int(gbm.n_iter_),
        "fit_seconds": round(time.time() - t0, 1),
    }
    if len(te):
        pt = gbm.predict_proba(X(te))[:, 1]
        result["test"] = _economics(te["net"].to_numpy(), pt >= best_t)
        lift = result["test"]["model_kept"]["per_trade"], result["test"]["all"]["per_trade"]
        result["test_verdict"] = (
            "model improved net P&L per trade on unseen data" if lift[0] is not None and lift[1] is not None and lift[0] > lift[1]
            else "model did NOT improve net P&L per trade on unseen data"
        )
        sample = te.sample(n=min(len(te), 20000), random_state=seed)
        pi = permutation_importance(gbm, X(sample), y(sample), scoring="roc_auc", n_repeats=3, random_state=seed)
        order = np.argsort(-pi.importances_mean)
        result["importance"] = [[feats[i], float(pi.importances_mean[i])] for i in order[:12]]

    config.MODELS.mkdir(parents=True, exist_ok=True)
    artifact = config.MODELS / f"meta_label_run{run_id}.joblib"
    joblib.dump({"model": gbm, "baseline": base, "features": feats, "threshold": best_t}, artifact)
    with db.tx() as con:
        con.execute(
            "INSERT INTO ml_models(run_id, created_at, kind, features, params, metrics, artifact) VALUES(?,?,?,?,?,?,?)",
            (run_id, time.time(), "meta_label_hgb", json.dumps(feats), json.dumps(gbm.get_params(), default=str), json.dumps(result), str(artifact)),
        )
    return result
