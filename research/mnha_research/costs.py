"""Indian equity transaction costs, effective-dated.

Statutory charges change over time, so each trade is charged the schedule in
force on its own entry date — never today's rates applied to 2021. A trade
dated before the earliest schedule raises rather than guessing. Schedules
before 2020-07-01 are approximations, chosen to err on the expensive side.

Brokerage is the broker's plan, not a statute. It is modelled on Groww's
equity plan and applied uniformly; VERIFY it against groww.in/pricing before
relying on absolute ₹ figures. Every run records COST_MODEL_VERSION.

Per leg (buy or sell), NSE cash market:
  brokerage   min(cap, pct × value), floored at min           (both legs)
  STT         delivery 0.1% both legs; intraday 0.025% sell leg
  exchange    NSE transaction charge × value                   (both legs)
  SEBI fee    ₹10 per crore × value                            (both legs)
  stamp duty  delivery 0.015%, intraday 0.003%                 (buy leg only)
  GST         18% on brokerage + exchange + SEBI
  DP charge   flat ₹ per delivery sell
STT and stamp are not rounded to the rupee here (contract notes do); the
difference is under ₹1 a leg.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np

from . import config

COST_MODEL_VERSION = "2026-11-04.1"


@dataclass(frozen=True)
class Statutory:
    valid_from: dt.date
    stt_delivery: float  # fraction, each leg
    stt_intraday_sell: float
    exchange_txn: float  # NSE cash, fraction of value, each leg
    sebi_per_crore: float  # ₹
    stamp_delivery_buy: float
    stamp_intraday_buy: float
    gst: float
    note: str


# Oldest first. From 2020-07-01 the schedules are the published rates. The two
# earlier ones are APPROXIMATE and deliberately not cheaper than reality:
#   delivery STT 0.125% until the 2012 Budget cut it to 0.1% (2012-07-01);
#   stamp duty was state-wise — charged at today's national 0.015% / 0.003%;
#   GST 18% stands in for the lower service tax of the time;
#   NSE transaction charge 0.0035%, SEBI fee ₹15 per crore.
# Data before 2003 is not served, so nothing earlier is needed. NSE moved to a
# single flat cash-market transaction charge on 2024-10-01.
STATUTORY: tuple[Statutory, ...] = (
    Statutory(dt.date(2003, 1, 1), 0.00125, 0.00025, 0.000035, 15.0, 0.00015, 0.00003, 0.18,
              "APPROXIMATE pre-2012: STT delivery 0.125%; stamp and GST at today's rates (conservative)"),
    Statutory(dt.date(2012, 7, 1), 0.001, 0.00025, 0.000035, 15.0, 0.00015, 0.00003, 0.18,
              "APPROXIMATE 2012-2020: STT delivery 0.1%; stamp and GST at today's rates (conservative)"),
    Statutory(dt.date(2020, 7, 1), 0.001, 0.00025, 0.0000325, 10.0, 0.00015, 0.00003, 0.18,
              "Stamp Act amendment (uniform stamp duty); NSE txn 0.00325%"),
    Statutory(dt.date(2024, 10, 1), 0.001, 0.00025, 0.0000297, 10.0, 0.00015, 0.00003, 0.18,
              "NSE flat cash-market transaction charge 0.00297%"),
)


@dataclass(frozen=True)
class BrokerPlan:
    pct: float = 0.001  # 0.1% of order value
    cap: float = 20.0  # ₹ per executed order
    floor: float = 5.0  # ₹ minimum per executed order
    dp_per_sell: float = 16.0  # ₹ per delivery sell, incl. GST
    name: str = "groww-equity (verify against groww.in/pricing)"


GROWW = BrokerPlan()

_FROM = np.array([np.datetime64(s.valid_from, "D").astype(np.int64) for s in STATUTORY])


def schedule_index(day: np.ndarray) -> np.ndarray:
    """Index into STATUTORY for each IST day number; raises if any precede it."""
    idx = np.searchsorted(_FROM, day, side="right") - 1
    if np.any(idx < 0):
        first = dt.date(1970, 1, 1) + dt.timedelta(days=int(day[idx < 0].min()))
        raise ValueError(f"no cost schedule for {first}; earliest is {STATUTORY[0].valid_from}")
    return idx


def _brokerage(value: np.ndarray, plan: BrokerPlan) -> np.ndarray:
    return np.where(value > 0, np.clip(value * plan.pct, plan.floor, plan.cap), 0.0)


def trade_costs(
    entry_value: np.ndarray,
    exit_value: np.ndarray,
    side: np.ndarray,
    entry_day: np.ndarray,
    intraday,
    plan: BrokerPlan = GROWW,
    multiplier: float = 1.0,
) -> np.ndarray:
    """Total ₹ charges for each round trip. side +1 long (buy then sell),
    -1 short (sell then buy). `intraday` is one bool for every trade or one
    per trade (bought and sold in the same session pays intraday STT and
    stamp, and no DP charge). `multiplier` scales everything for the cost
    sensitivity test."""
    entry_value = np.asarray(entry_value, dtype=float)
    exit_value = np.asarray(exit_value, dtype=float)
    side = np.asarray(side)
    buy = np.where(side > 0, entry_value, exit_value)
    sell = np.where(side > 0, exit_value, entry_value)
    if len(buy) == 0:
        return np.zeros(0)
    idx = schedule_index(np.asarray(entry_day, dtype=np.int64))
    stt_d = np.array([s.stt_delivery for s in STATUTORY])[idx]
    stt_i = np.array([s.stt_intraday_sell for s in STATUTORY])[idx]
    exch = np.array([s.exchange_txn for s in STATUTORY])[idx]
    sebi = np.array([s.sebi_per_crore for s in STATUTORY])[idx] / 1e7
    st_d = np.array([s.stamp_delivery_buy for s in STATUTORY])[idx]
    st_i = np.array([s.stamp_intraday_buy for s in STATUTORY])[idx]
    gst = np.array([s.gst for s in STATUTORY])[idx]

    brokerage = _brokerage(buy, plan) + _brokerage(sell, plan)
    turnover = buy + sell
    exchange = turnover * exch
    sebi_fee = turnover * sebi
    intra = np.broadcast_to(np.asarray(intraday, dtype=bool), buy.shape)
    stt = np.where(intra, sell * stt_i, turnover * stt_d)
    stamp = np.where(intra, buy * st_i, buy * st_d)
    dp = np.where(intra, 0.0, plan.dp_per_sell)
    total = brokerage + exchange + sebi_fee + gst * (brokerage + exchange + sebi_fee) + stt + stamp + dp
    return total * multiplier


def describe() -> dict:
    return {
        "version": COST_MODEL_VERSION,
        "broker": GROWW.__dict__,
        "statutory": [{**s.__dict__, "valid_from": s.valid_from.isoformat()} for s in STATUTORY],
        "slippage_bps": config.SLIPPAGE_BPS,
    }
