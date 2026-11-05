"""Strategy DNA: a canonical, hashable definition of one mechanical strategy.

A DNA is a plain dict:
  {"v": 1, "family": "trend", "tf": 15, "side": "both",
   "entry": {"rule": "ema_cross", "fast": 9, "slow": 50},
   "filters": [{"f": "adx_min", "t": 20}],
   "exit": {"stop": 1.5, "target": 3.0, "trail": 0.0, "opp": False, "time": 0}}

Stops, targets and trails are multiples of ATR(14) on the strategy's own
timeframe, so one definition means the same thing on every stock. tf < 1440
is intraday (MIS, flat by 15:15); tf == 1440 is swing (CNC delivery,
long-only, because a cash-equity short cannot be carried overnight in India).

Version 2 is the SHORT-HOLD program: cash equity only, every position closed
by the end of the third session after the one it was opened in. Its exit
carries `hold` = the most sessions a position may be carried overnight:
  hold 0  intraday — flat by 15:15 (on daily bars: buy the open, sell the close)
  hold N  CNC, long only — closed by the close of the Nth session after entry
Intraday-timeframe strategies that carry (hold >= 1) size their stops and
targets in DAILY ATR, since a 15-minute ATR means nothing overnight.

Generation is a seeded, stratified sample of each family's grid: every
candidate is canonicalised (irrelevant fields dropped, filters sorted) and
hashed, and a hash already seen is rejected — so the 100,000 are 100,000
distinct strategies, reproducible from the seed.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Iterator

import numpy as np

from . import config

VERSION = 1

FAMILIES = ("trend", "momentum", "mean_reversion", "breakout", "volume", "price_action", "volatility", "mtf")
CODE = {"trend": "TRD", "momentum": "MOM", "mean_reversion": "MRV", "breakout": "BRK",
        "volume": "VOL", "price_action": "PAC", "volatility": "VLT", "mtf": "MTF"}

INTRADAY_TF = (5, 15, 30, 60)
SWING_TF = (1440,)

# rule -> (param grid, allowed timeframes)
RULES: dict[str, tuple[dict[str, list], tuple[int, ...]]] = {
    "ema_cross": ({"fast": [5, 9, 13, 20], "slow": [21, 34, 50, 100, 200]}, INTRADAY_TF + SWING_TF),
    "price_ema": ({"n": [20, 50, 100, 200]}, INTRADAY_TF + SWING_TF),
    "supertrend": ({"n": [7, 10, 14], "mult": [1.5, 2.0, 2.5, 3.0, 4.0]}, INTRADAY_TF + SWING_TF),
    "di_cross": ({"n": [14, 20], "t": [15, 20, 25, 30]}, INTRADAY_TF + SWING_TF),
    "rsi_cross": ({"n": [7, 9, 14, 21], "level": [50, 55, 60, 65]}, INTRADAY_TF + SWING_TF),
    "macd_cross": ({"cfg": ["12-26-9", "8-21-5", "5-35-5", "19-39-9"], "zero": ["any", "with"]}, INTRADAY_TF + SWING_TF),
    "roc_atr": ({"n": [5, 10, 20], "t": [1.0, 1.5, 2.0, 3.0]}, INTRADAY_TF + SWING_TF),
    "bb_reentry": ({"n": [14, 20, 30], "k": [1.5, 2.0, 2.5, 3.0]}, INTRADAY_TF + SWING_TF),
    "rsi_reversal": ({"n": [2, 3, 5, 14], "level": [5, 10, 20, 25, 30]}, INTRADAY_TF + SWING_TF),
    "donchian": ({"n": [10, 20, 40, 55, 100, 250]}, INTRADAY_TF + SWING_TF),
    "prev_day": ({"buf": [0.0, 0.1, 0.25, 0.5]}, INTRADAY_TF),
    "opening_range": ({"win": [15, 30, 45, 60]}, INTRADAY_TF),
    "vwap_cross": ({"rv": [0.0, 1.0, 1.5, 2.0]}, INTRADAY_TF),
    "volume_spike": ({"rv": [2.0, 3.0, 4.0], "body": [0.3, 0.6, 1.0]}, INTRADAY_TF + SWING_TF),
    "inside_break": ({}, INTRADAY_TF + SWING_TF),
    "engulfing": ({"body": [0.5, 1.0]}, INTRADAY_TF + SWING_TF),
    "pullback": ({"n": [2, 3, 4], "trend": [20, 50]}, INTRADAY_TF + SWING_TF),
    "range_expansion": ({"k": [1.5, 2.0, 2.5, 3.0]}, INTRADAY_TF + SWING_TF),
    "bb_squeeze": ({"q": [50, 100, 150]}, INTRADAY_TF + SWING_TF),
    # short-hold program (v2) only
    "ibs": ({"t": [0.1, 0.2, 0.3]}, INTRADAY_TF + SWING_TF),
    "down_days": ({"n": [2, 3, 4, 5]}, INTRADAY_TF + SWING_TF),
    "gap": ({"g": [0.01, 0.02, 0.03], "mode": ["go", "fade"]}, INTRADAY_TF),
    "nr_break": ({"n": [4, 7]}, INTRADAY_TF + SWING_TF),
}

FAMILY_RULES = {
    "trend": ["ema_cross", "price_ema", "supertrend", "di_cross"],
    "momentum": ["rsi_cross", "macd_cross", "roc_atr"],
    "mean_reversion": ["bb_reentry", "rsi_reversal"],
    "breakout": ["donchian", "prev_day", "opening_range"],
    "volume": ["vwap_cross", "volume_spike"],
    "price_action": ["inside_break", "engulfing", "pullback"],
    "volatility": ["range_expansion", "bb_squeeze"],
    "mtf": ["ema_cross", "rsi_cross", "macd_cross", "donchian", "bb_reentry", "supertrend", "vwap_cross"],
}

FILTERS: list[dict[str, Any]] = [
    {"f": "trend_ema", "n": 50}, {"f": "trend_ema", "n": 100}, {"f": "trend_ema", "n": 200},
    {"f": "adx_min", "t": 20}, {"f": "adx_min", "t": 25},
    {"f": "adx_max", "t": 20}, {"f": "adx_max", "t": 25},
    {"f": "relvol_min", "t": 1.2}, {"f": "relvol_min", "t": 1.5}, {"f": "relvol_min", "t": 2.0},
    {"f": "session", "w": "morning"}, {"f": "session", "w": "afternoon"}, {"f": "session", "w": "skip_open"},
]
HTF_FILTERS: list[dict[str, Any]] = [
    {"f": "htf_trend", "htf": 60, "n": 20}, {"f": "htf_trend", "htf": 60, "n": 50},
    {"f": "htf_trend", "htf": 1440, "n": 20}, {"f": "htf_trend", "htf": 1440, "n": 50},
    {"f": "htf_trend", "htf": 1440, "n": 200},
]

STOP_K = [1.0, 1.5, 2.0, 3.0]
TARGET_K = [0.0, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0]  # 0 = no fixed target
TRAIL_K = [0.0, 1.5, 2.0, 3.0]  # 0 = no trailing stop
SWING_TIME = [5, 10, 20, 40]  # daily bars

# ---- short-hold program (v2)
SHORT_VERSION = 2
SHORT_FAMILIES = FAMILIES + ("short_term",)
CODE["short_term"] = "STM"
SHORT_FAMILY_RULES = {**FAMILY_RULES, "short_term": ["ibs", "down_days", "gap", "nr_break"]}
# NSE delivery share of traded quantity (MTO): a daily bar sees its own
# session's figure (published after the close; the trade fills next open),
# an intraday bar the previous session's.
DELIV_FILTERS: list[dict[str, Any]] = [
    {"f": "deliv_min", "t": 0.5}, {"f": "deliv_min", "t": 0.6},
    {"f": "deliv_max", "t": 0.35},
    {"f": "deliv_rel", "t": 1.2}, {"f": "deliv_rel", "t": 1.5},
]
HOLDS = [0, 1, 2, 3]  # sessions carried overnight at most
CARRY_TF = (15, 30, 60)  # intraday timeframes that may carry overnight
SHORT_STOP_K = [1.0, 1.5, 2.0, 3.0, 5.0]


def canonical(d: dict) -> str:
    return json.dumps(d, sort_keys=True, separators=(",", ":"))


def dna_hash(d: dict) -> str:
    return hashlib.sha1(canonical(d).encode()).hexdigest()[:16]


def _filter_kind(f: dict) -> str:
    return f["f"]


def _entry(d: dict) -> dict | None:
    tf = d["tf"]
    entry = dict(d["entry"])
    rule = entry["rule"]
    grid, tfs = RULES[rule]
    if tf not in tfs:
        return None
    if rule == "ema_cross" and entry["fast"] >= entry["slow"]:
        return None
    if rule == "opening_range" and (entry["win"] < tf or entry["win"] % tf):
        return None
    if rule == "donchian" and tf < 1440 and entry["n"] > 100:
        return None
    return entry


def _filters(d: dict) -> list[dict] | None:
    tf = d["tf"]
    filters = []
    kinds = set()
    for f in d.get("filters", []):
        k = _filter_kind(f)
        if k in kinds:
            return None
        if k == "session" and tf >= 1440:
            return None
        if k == "htf_trend" and f["htf"] <= tf:
            return None
        kinds.add(k)
        filters.append(dict(f))
    if {"adx_min", "adx_max"} <= kinds or {"deliv_min", "deliv_max"} <= kinds:
        return None
    if d["family"] == "mtf" and "htf_trend" not in kinds:
        return None
    if d["family"] != "mtf" and "htf_trend" in kinds:
        return None
    filters.sort(key=canonical)
    return filters


def normalise(d: dict) -> dict | None:
    """Drop what does not apply, sort filters, reject contradictions. None = invalid."""
    if d.get("v") == SHORT_VERSION:
        return _normalise_short(d)
    tf = d["tf"]
    entry = _entry(d)
    filters = _filters(d)
    if entry is None or filters is None:
        return None
    ex = dict(d["exit"])
    side = d["side"]
    if tf >= 1440:
        side = "long"
        ex["time"] = int(ex.get("time") or config.SWING_MAX_HOLD)
    else:
        ex["time"] = 0
    ex["stop"] = float(ex["stop"])
    ex["target"] = float(ex.get("target") or 0.0)
    ex["trail"] = float(ex.get("trail") or 0.0)
    ex["opp"] = bool(ex.get("opp"))
    return {"v": VERSION, "family": d["family"], "tf": tf, "side": side, "entry": entry, "filters": filters, "exit": ex}


def _normalise_short(d: dict) -> dict | None:
    tf = d["tf"]
    entry = _entry(d)
    filters = _filters(d)
    if entry is None or filters is None:
        return None
    ex = dict(d["exit"])
    hold = int(ex["hold"])
    if hold not in HOLDS or (tf < 1440 and hold > 0 and tf not in CARRY_TF):
        return None
    side = d["side"] if hold == 0 else "long"  # no overnight short in cash equity
    out = {"stop": float(ex["stop"]), "target": float(ex.get("target") or 0.0), "trail": float(ex.get("trail") or 0.0),
           "opp": bool(ex.get("opp")), "time": 0, "hold": hold}
    if tf >= 1440 and hold == 0:
        # buy the open, sell the close: a trail or an opposite signal never acts
        out["trail"], out["opp"] = 0.0, False
    return {"v": SHORT_VERSION, "family": d["family"], "tf": tf, "side": side, "entry": entry, "filters": filters, "exit": out}


def _sample_short(family: str, rng: np.random.Generator) -> dict | None:
    rules_ = SHORT_FAMILY_RULES[family]
    rule = rules_[rng.integers(len(rules_))]
    grid, tfs = RULES[rule]
    tfs = tuple(t for t in tfs if t in config.INTERVALS)
    if family == "mtf":
        tfs = tuple(t for t in tfs if t < 1440)
    tf = int(tfs[rng.integers(len(tfs))])
    entry: dict[str, Any] = {"rule": rule}
    for k, vals in grid.items():
        entry[k] = vals[rng.integers(len(vals))]
    if tf >= 1440:
        hold = int(HOLDS[rng.integers(len(HOLDS))])
    elif tf in CARRY_TF and rng.random() < 0.5:
        hold = int(HOLDS[1 + rng.integers(len(HOLDS) - 1)])
    else:
        hold = 0
    pool = FILTERS + DELIV_FILTERS
    filters: list[dict] = []
    if family == "mtf":
        opts = [f for f in HTF_FILTERS if f["htf"] > tf]
        if not opts:
            return None
        filters.append(opts[rng.integers(len(opts))])
        n_extra = int(rng.choice([0, 1], p=[0.6, 0.4]))
    else:
        n_extra = int(rng.choice([0, 1, 2], p=[0.35, 0.4, 0.25]))
    for _ in range(n_extra):
        filters.append(pool[rng.integers(len(pool))])
    side = ["long", "short", "both"][rng.integers(3)] if hold == 0 else "long"
    ex = {
        "stop": SHORT_STOP_K[rng.integers(len(SHORT_STOP_K))],
        "target": TARGET_K[rng.integers(len(TARGET_K))],
        "trail": TRAIL_K[rng.integers(len(TRAIL_K))],
        "opp": bool(rng.integers(2)),
        "hold": hold,
    }
    return normalise({"v": SHORT_VERSION, "family": family, "tf": tf, "side": side, "entry": entry, "filters": filters, "exit": ex})


def _sample_family(family: str, rng: np.random.Generator) -> dict | None:
    rule = FAMILY_RULES[family][rng.integers(len(FAMILY_RULES[family]))]
    grid, tfs = RULES[rule]
    tfs = tuple(t for t in tfs if t in config.INTERVALS)
    if family == "mtf":
        tfs = tuple(t for t in tfs if t < 1440)
    tf = int(tfs[rng.integers(len(tfs))])
    entry: dict[str, Any] = {"rule": rule}
    for k, vals in grid.items():
        entry[k] = vals[rng.integers(len(vals))]
    filters: list[dict] = []
    if family == "mtf":
        opts = [f for f in HTF_FILTERS if f["htf"] > tf]
        if not opts:
            return None
        filters.append(opts[rng.integers(len(opts))])
        n_extra = int(rng.choice([0, 1], p=[0.6, 0.4]))
    else:
        n_extra = int(rng.choice([0, 1, 2], p=[0.35, 0.4, 0.25]))
    for _ in range(n_extra):
        filters.append(FILTERS[rng.integers(len(FILTERS))])
    side = ["long", "short", "both"][rng.integers(3)] if tf < 1440 else "long"
    ex = {
        "stop": STOP_K[rng.integers(len(STOP_K))],
        "target": TARGET_K[rng.integers(len(TARGET_K))],
        "trail": TRAIL_K[rng.integers(len(TRAIL_K))],
        "opp": bool(rng.integers(2)),
        "time": SWING_TIME[rng.integers(len(SWING_TIME))] if tf >= 1440 else 0,
    }
    return normalise({"family": family, "tf": tf, "side": side, "entry": entry, "filters": filters, "exit": ex})


def generate(total: int = config.TARGET_STRATEGIES, seed: int = config.SEED, version: int = VERSION) -> list[tuple[str, str, dict]]:
    """[(id, hash, dna)] — `total` unique strategies, an equal share per family.
    version 1 is the original program, version 2 the short-hold one."""
    short = version == SHORT_VERSION
    families = SHORT_FAMILIES if short else FAMILIES
    sample = _sample_short if short else _sample_family
    prefix = "NSS" if short else "NSE"
    per = [total // len(families)] * len(families)
    for i in range(total - sum(per)):
        per[i] += 1
    seen: set[str] = set()
    out: list[tuple[str, str, dict]] = []
    for fi, family in enumerate(families):
        rng = np.random.default_rng(seed + 7919 * fi)
        got = 0
        attempts = 0
        while got < per[fi]:
            attempts += 1
            if attempts > per[fi] * 200:
                raise RuntimeError(f"{family}: grid too small for {per[fi]} unique strategies (got {got})")
            d = sample(family, rng)
            if d is None:
                continue
            h = dna_hash(d)
            if h in seen:
                continue
            seen.add(h)
            got += 1
            out.append((f"{prefix}-{CODE[family]}-{got:06d}", h, d))
    return out


def neighbours(d: dict) -> Iterator[dict]:
    """Strategies one grid step away in a single parameter — for the stability test."""
    rule = d["entry"]["rule"]
    grid, _ = RULES[rule]
    for k, vals in grid.items():
        cur = d["entry"][k]
        if cur not in vals:
            continue
        i = vals.index(cur)
        for j in (i - 1, i + 1):
            if 0 <= j < len(vals):
                nd = json.loads(canonical(d))
                nd["entry"][k] = vals[j]
                n = normalise(nd)
                if n is not None:
                    yield n
    short = d.get("v") == SHORT_VERSION
    steps = [("stop", SHORT_STOP_K if short else STOP_K), ("target", TARGET_K), ("trail", TRAIL_K)]
    if short:
        steps.append(("hold", HOLDS))
    for key, vals in steps:
        cur = d["exit"][key]
        if cur not in vals:
            continue
        i = vals.index(cur)
        for j in (i - 1, i + 1):
            if 0 <= j < len(vals):
                nd = json.loads(canonical(d))
                nd["exit"][key] = vals[j]
                n = normalise(nd)
                # (a trail on a buy-the-open, sell-the-close strategy normalises away)
                if n is not None and canonical(n) != canonical(d):
                    yield n
