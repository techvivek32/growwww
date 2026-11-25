"""The paper-trading SESSION LOOP: one process per trading day, 09:12 to 15:30 IST. NO ORDER IS EVER SENT FROM HERE
(the website's live executor reads book A's recorded decisions and places its own orders).

It runs the 2026 strategy (livex) and watches the open paper positions every 5 seconds at Groww's live prices.
Two paper books take the SAME picks:
  A  "main"  the strategy as tested: 0.5% market stop (average stock up 0.5% since 09:20), 10:15 flip, square-off
             15:15. Its official result is `livex.settle`, priced from the 5-minute bars.
  B  "sl05"  the user's rule: a fixed 0.5% stop on every position (short covered when the price is 0.5% above the
             entry; the flip long sold 0.5% below its entry), no profit target, otherwise the same entries and the
             15:15 square-off. Its exits are taken at the live price the moment the 5-second check sees the stop
             hit, with the usual slippage, and recorded in livex_fast.

Timeline: 09:20 decide (livex.decide) → every 5 s: quotes for the open names, stop checks for book B, a live mark
every 30 s, and at each 5-minute close book A's market stop (livex.market_stop_check, recorded for the website's
live executor) → 10:15 flip (livex.flip) → 15:15 square-off at the live price for book B → 15:17 settle
(livex.settle) for book A and the bar-based record.
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
DECIDE_RETRY_S = 15  # while the 09:15 bars are still arriving
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
        # Never over an existing leg: a restarted session must not reopen a closed one.
        cur = con.execute("INSERT OR IGNORE INTO livex_fast(day, book, leg, symbol, side, qty, entry, entry_at) VALUES(?,?,?,?,?,?,?,?)",
                          (day, "sl05", leg, symbol, side, q, e, at))
    if cur.rowcount:
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
    # catch-up: an earlier session left unsettled (its settle kept failing until 15:30) is settled now from its bars
    try:
        lc = livex._db()
        for (d0,) in lc.execute("SELECT day FROM livex_days WHERE day<? AND day>=? AND status IN ('decided', 'flipped') ORDER BY day", (day, day - 10)).fetchall():
            try:
                log(f"catch-up settle of {day_to_date(int(d0))}: {json.dumps(livex.settle(int(d0)), default=str)[:300]}")
            except Exception as e:  # noqa: BLE001
                log(f"catch-up settle of {day_to_date(int(d0))} failed: {e}")
    except Exception as e:  # noqa: BLE001
        log(f"catch-up check failed: {e}")
    log(f"session {date}: preparing the decision context")
    ctx = None
    try:
        ctx = livex.prepare_ctx(day)
    except Exception as e:  # noqa: BLE001  decide() will retry the preparation itself
        log(f"context preparation failed: {e}")
    log(f"session {date}: waiting for 09:20")
    decided = False
    next_decide = 0.0
    decide_fails = 0
    flipped = False
    next_flip = 0.0
    flip_fails = 0
    last_mark = 0.0
    last_mstop_bar = -1
    squared = False
    summary: dict = {"day": date.isoformat()}
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 30:
            break
        try:
            if not decided and minute >= 9 * 60 + 20 + 2 / 60 and now >= next_decide:
                # A decision that raises backs off instead of re-fetching all day: gaps of at most a minute
                # while a timely decision is still possible (to 09:35), then up to 10 minutes.
                next_decide = now + min(DECIDE_RETRY_S * 2 ** decide_fails, 60 if minute < 9 * 60 + 35 else 600)
                decide_fails += 1
                if ctx is None:
                    ctx = livex.prepare_ctx(day)  # built once and kept for every retry
                out = livex.decide(wait=False, ctx=ctx)
                decide_fails = 0
                next_decide = time.time() + DECIDE_RETRY_S  # 15 s between attempts, not between their starts
                # "waiting for bars": the 09:15 bars are still arriving (a slow or throttled feed), so
                # try again shortly; decide() itself calls the day off as a holiday after 09:35.
                decided = out.get("status") not in (None, "weekend", "waiting for bars")
                summary["decide"] = out
                if out.get("status", "").startswith("no session"):
                    log("no session today (holiday)")
                    return summary
                if decided:
                    row = con.execute("SELECT skip, pick, pick_px FROM livex_days WHERE day=?", (day,)).fetchone()
                    if row and not row[0] and row[1]:
                        _open_leg(con, day, "short", row[1], -1, float(row[2]), now)
            if decided and not squared:
                # Book A's market stop for the website's live executor: each 5-minute close is checked once, in
                # its own try, BEFORE the 10:15 flip's long fetch (so the 10:15 close is never missed) and before
                # book B's checks (so a failed quote never holds them up).
                t = time.time()  # not the loop's `now`: a slow decide() in this pass would make it stale
                bar = livex.mstop_bar_due(t)
                if bar is not None and bar != last_mstop_bar:
                    try:
                        res = livex.market_stop_check(t, con)
                        if res.get("checked"):
                            last_mstop_bar = bar
                        if res.get("stop"):
                            summary["mstop"] = res
                    except Exception as e:  # noqa: BLE001
                        log(f"market stop check failed: {e}")
            if decided and not flipped and minute >= 10 * 60 + 15 + 0.5 and now >= next_flip:
                # Its own try: a flip that is not done yet never holds up book B's stop checks, the square-off
                # or the settle below, and it backs off instead of re-fetching back to back.
                try:
                    if minute >= 10 * 60 + 45:
                        # Too late for book B to follow a flip at its 10:15 price: it keeps its position, and
                        # settle() decides and stores book A's flip from the bars if none was recorded.
                        log("the 10:15 flip was not done by 10:45: book B keeps its position")
                        flipped = True
                    else:
                        if "flip" not in summary:
                            summary["flip"] = livex.flip()
                        # Book B follows the RECORDED 10:15 decision (this run's or another's): cover the short
                        # at the live price (if its stop has not already closed it) and buy the top gainer, like
                        # book A, but never on a regime-skip day, when book A takes nothing. Done once it all works.
                        rec = con.execute("SELECT skip, flip, flip_symbol, flip_px FROM livex_days WHERE day=?", (day,)).fetchone()
                        if rec and rec[1] is not None:
                            if rec[1] and rec[2] and not rec[0]:
                                legs = [l for l in _open_legs(con, day) if l[0] == "short"]
                                if legs:
                                    _close_leg(con, day, "short", _quote(legs), now, "flip cover")
                                _open_leg(con, day, "flip_long", rec[2], 1, float(rec[3]), now)
                            flipped = True
                    flip_fails = 0
                except Exception as e:  # noqa: BLE001
                    flip_fails += 1
                    log(f"flip not done yet: {e}")
                next_flip = time.time() + min(DECIDE_RETRY_S * 2 ** flip_fails, 120)
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
                # one mark on the pass that squares off, whatever the 30 s timer says: the card then shows the
                # 15:15 state until the settle
                if (squared or now - last_mark >= MARK_EVERY_S) and minute <= 15 * 60 + 20:
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
    """Live price of the open short (book B) for the flip cover; raises when there is none (the loop retries)."""
    if legs:
        q = livex._ltp_many([legs[0][1]])
        if legs[0][1] in q:
            return q[legs[0][1]]
    raise RuntimeError("no quote for the open short")


TRADE_DAYS = 180  # sessions of legs served to the dashboard; it reports anything older as not served


def report_sl05() -> dict:
    con = _db()
    import pandas as pd

    T = pd.read_sql_query("SELECT * FROM livex_fast WHERE book='sl05' AND net IS NOT NULL", con)
    if T.empty:
        return {"days": 0}
    daily = T.groupby("day").net.sum()
    mo = daily.groupby(pd.to_datetime(daily.index, unit="D").to_period("M")).sum()
    # Legs of the latest TRADE_DAYS sessions, cut by DAY: half a day's legs would make the
    # dashboard's day total a number no session ever produced. The summary above stays complete.
    served = sorted(T.day.unique())[-TRADE_DAYS:]
    W = T[T.day.isin(served)]
    return {"days": int(len(daily)), "trades_from": int(served[0]), "net_rs": round(float(daily.sum())), "pct_of_book": round(float(daily.sum() / livex.BOOK * 100), 2),
            "per_month_pct": {str(k): round(float(v / livex.BOOK * 100), 2) for k, v in mo.items()},
            "stopped_out_share": round(float((T.why == "stop 0.5%").mean()), 3), "worst_day_rs": round(float(daily.min())),
            "trades": [{"day": day_to_date(int(r.day)).isoformat(), "leg": r.leg, "symbol": r.symbol, "side": int(r.side),
                        "qty": int(r.qty), "entry": round(r.entry, 2), "entry_at": r.entry_at,
                        "exit": round(r.exit, 2) if r.exit else None, "exit_at": r.exit_at, "why": r.why,
                        "costs": round(r.costs, 2) if r.costs is not None else None,
                        "net": round(r.net)} for r in W.sort_values("day", ascending=False).itertuples()]}


def replay_b(day: int) -> dict:
    """Book B for a PAST session from the 5-minute bars (when the 5-second loop did not run): the same entries as
    book A, a 0.5% stop checked bar by bar (a bar whose high/low reaches the stop fills at the stop price, or at
    the worse open), the flip cover/long at the 10:15 close, square-off 15:15."""
    con = _db()
    r = con.execute("SELECT status, skip, pick, pick_px, flip, flip_symbol, flip_px FROM livex_days WHERE day=?", (day,)).fetchone()
    if not r or r[0] != "settled" or r[1] or not r[2]:
        return {"day": day_to_date(day).isoformat(), "status": "nothing to replay"}
    _status, _skip, pick, pick_px, flip_on, flip_sym, flip_px = r
    P = livex._paths_today(day, [pick] + ([flip_sym] if flip_on and flip_sym else []))
    con.execute("DELETE FROM livex_fast WHERE day=? AND book='sl05'", (day,))
    con.commit()
    t0 = day * 86400 - 19800
    out = []

    def run_leg(leg, sym, side, raw_entry, eb, xb_rule, why_rule):
        a = P[sym]
        _open_leg(con, day, leg, sym, side, raw_entry, t0 + (9 * 60 + 20 + 5 * eb) * 60)
        e = con.execute("SELECT entry FROM livex_fast WHERE day=? AND book='sl05' AND leg=?", (day, leg)).fetchone()[0]
        sp = e * (1 + STOP) if side < 0 else e * (1 - STOP)
        for i in range(eb + 1, xb_rule + 1):
            o, h, l = a[0, i], a[1, i], a[2, i]
            hit = (o >= sp or h >= sp) if side < 0 else (o <= sp or l <= sp)
            if hit:
                px = o if ((side < 0 and o >= sp) or (side > 0 and o <= sp)) else sp
                _close_leg(con, day, leg, float(px), t0 + (9 * 60 + 20 + 5 * i) * 60, "stop 0.5%")
                return
        _close_leg(con, day, leg, float(a[3, xb_rule]), t0 + (9 * 60 + 20 + 5 * xb_rule) * 60, why_rule)

    if flip_on and flip_sym and flip_sym in P:
        run_leg("short", pick, -1, float(pick_px), 0, livex.FLIP_BAR, "flip cover")
        run_leg("flip_long", flip_sym, 1, float(flip_px), livex.FLIP_BAR, livex.EXIT_BAR, "square-off 15:15")
    else:
        run_leg("short", pick, -1, float(pick_px), 0, livex.EXIT_BAR, "square-off 15:15")
    rows = [dict(zip(("leg", "symbol", "entry", "exit", "why", "net"), x)) for x in con.execute(
        "SELECT leg, symbol, entry, exit, why, net FROM livex_fast WHERE day=? AND book='sl05'", (day,))]
    return {"day": day_to_date(day).isoformat(), "legs": rows, "net": round(sum(x["net"] or 0 for x in rows), 2)}
