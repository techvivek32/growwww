"""The paper-trading SESSION LOOP: one process per trading day, 09:12 to 15:30 IST. NO ORDER IS EVER SENT.

It runs the 2026 strategy (livex) and watches the open paper positions every 5 seconds at Groww's live prices.
Two paper books take the SAME picks:
  A  "main"  the strategy as tested: 0.5% market stop (average stock up 0.5% since 09:20), 10:15 flip, square-off
             15:15. Its official result is `livex.settle`, priced from the 5-minute bars.
  B  "sl05"  the user's rule: a fixed 0.5% stop on every position (short covered when the price is 0.5% above the
             entry; the flip long sold 0.5% below its entry), no profit target, otherwise the same entries and the
             15:15 square-off. Its exits are taken at the live price the moment the 5-second check sees the stop
             hit, with the usual slippage, and recorded in livex_fast.

Timeline: 09:20 decide (livex.decide) → every 5 s: quotes for the open names, stop checks for book B, a live mark
every 30 s → 10:15 flip (livex.flip) → 15:15 square-off at the live price for book B → 15:17 settle (livex.settle)
for book A and the bar-based record.
"""

from __future__ import annotations

import json
import math
import time

import numpy as np

from . import lab, live, livex
from .costs import trade_costs
from .validation import day_to_date

STOP = 0.005
POLL_S = 5
MARK_EVERY_S = 30
SCHEMA = """
CREATE TABLE IF NOT EXISTS livex_fast (
  day INTEGER NOT NULL, book TEXT NOT NULL, leg TEXT NOT NULL, symbol TEXT NOT NULL, side INTEGER NOT NULL, qty REAL NOT NULL,
  entry REAL NOT NULL, entry_at REAL NOT NULL, exit REAL, exit_at REAL, why TEXT, gross REAL, costs REAL, net REAL,
  PRIMARY KEY (day, book, leg)
);
"""
log = livex.log


def _db():
    con = livex._db()
    con.executescript(SCHEMA)
    return con


def _slip(px: float, day: int) -> float:
    return max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([px]), np.array([day]))[0]) / px)


def _open_leg(con, day: int, leg: str, symbol: str, side: int, raw_px: float, at: float) -> None:
    s = _slip(raw_px, day)
    e = raw_px * (1 + s * side)
    q = math.floor(livex.BOOK / e)
    with con:
        con.execute("INSERT OR REPLACE INTO livex_fast(day, book, leg, symbol, side, qty, entry, entry_at) VALUES(?,?,?,?,?,?,?,?)",
                    (day, "sl05", leg, symbol, side, q, e, at))
    log(f"[B sl05] open {leg}: {'SHORT' if side < 0 else 'LONG'} {symbol} {q} @ {e:.2f}")


def _close_leg(con, day: int, leg: str, raw_px: float, at: float, why: str) -> None:
    r = con.execute("SELECT symbol, side, qty, entry FROM livex_fast WHERE day=? AND book='sl05' AND leg=? AND exit IS NULL", (day, leg)).fetchone()
    if not r:
        return
    sym, side, q, e = r
    s = _slip(raw_px, day)
    x = raw_px * (1 - s * side)
    gross = (x - e) * q * side
    costs = float(trade_costs(np.array([q * e]), np.array([q * x]), np.array([side]), np.array([day]), True)[0])
    with con:
        con.execute("UPDATE livex_fast SET exit=?, exit_at=?, why=?, gross=?, costs=?, net=? WHERE day=? AND book='sl05' AND leg=?",
                    (x, at, why, gross, costs, gross - costs, day, leg))
    log(f"[B sl05] close {leg}: {sym} @ {x:.2f} ({why}) net Rs {gross - costs:,.0f}")


def _open_legs(con, day: int) -> list[tuple]:
    return con.execute("SELECT leg, symbol, side, entry FROM livex_fast WHERE day=? AND book='sl05' AND exit IS NULL", (day,)).fetchall()


def session() -> dict:
    day = live.today_ist()
    date = day_to_date(day)
    if date.weekday() >= 5:
        return {"status": "weekend"}
    con = _db()
    log(f"session {date}: waiting for 09:20")
    decided = False
    flipped = False
    last_mark = 0.0
    squared = False
    summary: dict = {"day": date.isoformat()}
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 30:
            break
        try:
            if not decided and minute >= 9 * 60 + 20 + 2 / 60:
                out = livex.decide(wait=False)
                decided = out.get("status") not in (None, "weekend")
                summary["decide"] = out
                if out.get("status", "").startswith("no session"):
                    log("no session today (holiday)")
                    return summary
                row = con.execute("SELECT skip, pick, pick_px FROM livex_days WHERE day=?", (day,)).fetchone()
                if row and not row[0] and row[1]:
                    _open_leg(con, day, "short", row[1], -1, float(row[2]), now)
            if decided and not flipped and minute >= 10 * 60 + 15 + 0.5:
                out = livex.flip()
                flipped = True
                summary["flip"] = out
                if out.get("flip"):
                    r = con.execute("SELECT flip_symbol, flip_px FROM livex_days WHERE day=?", (day,)).fetchone()
                    if r and r[0]:
                        # book B: cover the short at the live price (if its stop has not already closed it) and buy the
                        # top gainer, like book A
                        legs = _open_legs(con, day)
                        if legs:
                            _close_leg(con, day, "short", _quote(legs), now, "flip cover")
                        _open_leg(con, day, "flip_long", r[0], 1, float(r[1]), now)
            if decided and not squared:
                legs = _open_legs(con, day)
                if legs:
                    q = livex._ltp_many([l[1] for l in legs])
                    for leg, sym, side, e in legs:
                        px = q.get(sym)
                        if px is None:
                            continue
                        if minute >= 15 * 60 + 15:
                            _close_leg(con, day, leg, px, now, "square-off 15:15")
                        elif side < 0 and px >= e * (1 + STOP):
                            _close_leg(con, day, leg, px, now, "stop 0.5%")
                        elif side > 0 and px <= e * (1 - STOP):
                            _close_leg(con, day, leg, px, now, "stop 0.5%")
                if minute >= 15 * 60 + 15:
                    squared = True
                if now - last_mark >= MARK_EVERY_S and minute <= 15 * 60 + 20:
                    livex.mark()
                    last_mark = now
            if squared and minute >= 15 * 60 + 17 and "settle" not in summary:
                summary["settle"] = livex.settle()
                log(json.dumps(summary.get("settle"), default=str))
                break
        except Exception as e:  # noqa: BLE001  keep the loop alive through a failed quote
            log(f"session loop error: {e}")
        time.sleep(POLL_S)
    summary["sl05"] = [dict(zip(("leg", "symbol", "side", "qty", "entry", "exit", "why", "net"), r)) for r in con.execute(
        "SELECT leg, symbol, side, qty, entry, exit, why, net FROM livex_fast WHERE day=? AND book='sl05'", (day,))]
    log(json.dumps(summary, default=str))
    return summary


def _quote(legs) -> float:
    """Live price of the open short (book B) for the flip cover; falls back to the latest mark."""
    if legs:
        q = livex._ltp_many([legs[0][1]])
        if legs[0][1] in q:
            return q[legs[0][1]]
    raise RuntimeError("no quote for the open short")


def report_sl05() -> dict:
    con = _db()
    import pandas as pd

    T = pd.read_sql_query("SELECT * FROM livex_fast WHERE book='sl05' AND net IS NOT NULL", con)
    if T.empty:
        return {"days": 0}
    daily = T.groupby("day").net.sum()
    mo = daily.groupby(pd.to_datetime(daily.index, unit="D").to_period("M")).sum()
    return {"days": int(len(daily)), "net_rs": round(float(daily.sum())), "pct_of_book": round(float(daily.sum() / livex.BOOK * 100), 2),
            "per_month_pct": {str(k): round(float(v / livex.BOOK * 100), 2) for k, v in mo.items()},
            "stopped_out_share": round(float((T.why == "stop 0.5%").mean()), 3), "worst_day_rs": round(float(daily.min())),
            "trades": [{"day": day_to_date(int(r.day)).isoformat(), "leg": r.leg, "symbol": r.symbol, "entry": round(r.entry, 2),
                        "exit": round(r.exit, 2) if r.exit else None, "why": r.why, "net": round(r.net)} for r in T.sort_values("day", ascending=False).head(30).itertuples()]}
