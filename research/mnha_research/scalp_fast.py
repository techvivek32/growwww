"""Fast scalp book (paper, no orders): tick-level buy-sell-buy-sell, as the admin asked on 23 Nov 2026.

Six rules watch the 100 most liquid names on the LTP feed every ~5 seconds and trade each with the full ₹5 lakh:
momentum (price up/down X% within W seconds → go with it), fade (same move → go against it). Each rule holds one
position at a time, exits on its target, stop or time limit, and re-enters as soon as the next signal appears, all
day until 15:15. Groww intraday costs and slippage on every trade. Files: data/scalping/fast/<date>.json.
Separate from Book A/B, from the 100-strategy daily replay and from the per-strategy live scalp book.
"""

from __future__ import annotations

import json
import time
from collections import deque

from . import config, live, scalp
from .validation import day_to_date

BOOK = 500_000.0
UNIVERSE = 100
POLL_S = 5
SLIP = 3e-4
SQUARE_OFF_MIN = 15 * 60 + 15
RULES = [  # name, side (+1 buy / -1 sell), kind, move (fraction), window (s), target, stop, max hold (s)
    {"rule": 1, "name": "momentum buy 0.25%/60s", "side": 1, "kind": "momentum", "move": 0.0025, "window": 60, "target": 0.003, "stop": 0.002, "hold": 300},
    {"rule": 2, "name": "momentum sell 0.25%/60s", "side": -1, "kind": "momentum", "move": 0.0025, "window": 60, "target": 0.003, "stop": 0.002, "hold": 300},
    {"rule": 3, "name": "fade sell after +0.4%/60s", "side": -1, "kind": "fade", "move": 0.004, "window": 60, "target": 0.003, "stop": 0.003, "hold": 300},
    {"rule": 4, "name": "fade buy after −0.4%/60s", "side": 1, "kind": "fade", "move": 0.004, "window": 60, "target": 0.003, "stop": 0.003, "hold": 300},
    {"rule": 5, "name": "momentum buy 0.5%/120s", "side": 1, "kind": "momentum", "move": 0.005, "window": 120, "target": 0.005, "stop": 0.003, "hold": 600},
    {"rule": 6, "name": "momentum sell 0.5%/120s", "side": -1, "kind": "momentum", "move": 0.005, "window": 120, "target": 0.005, "stop": 0.003, "hold": 600},
]


def _dir():
    d = config.DATA / "scalping" / "fast"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "scalp-fast", msg, flush=True)


def _ltp_all(syms: list[str]) -> tuple[dict[str, float], float]:
    out: dict[str, float] = {}
    for i in range(0, len(syms), 50):
        px, _ = live.ltp(syms[i : i + 50])
        out.update(px)
    return out, time.time()


def session() -> dict:
    day = live.today_ist()
    date = day_to_date(day)
    if date.weekday() >= 5:
        return {"status": "weekend"}
    res = json.loads((config.DATA / "scalping" / "results.json").read_text())
    liq = res["liq_rank"]
    syms = sorted(liq, key=lambda s: liq[s])[:UNIVERSE]
    hist: dict[str, deque] = {s: deque(maxlen=60) for s in syms}  # (t, px) last ~5 minutes
    path = _dir() / f"{date.isoformat()}.json"
    books = [{**r, "status": "flat", "position": None, "trades": [], "net_rs": 0.0, "gross_rs": 0.0, "cost_rs": 0.0, "n": 0, "wins": 0} for r in RULES]
    state = {"day": date.isoformat(), "universe": len(syms), "started_at": time.time(), "status": "watching", "books": books}

    def save():
        state["updated_at"] = time.time()
        tot = sum(b["net_rs"] for b in books) + sum(b["position"]["pnl_rs"] for b in books if b["position"])
        state["summary"] = {"total_rs": round(tot, 2), "realised_rs": round(sum(b["net_rs"] for b in books), 2), "trades": sum(b["n"] for b in books),
                            "open": sum(1 for b in books if b["position"])}
        # keep the file small: the last 40 trades per book are served, the count is complete
        slim = {**state, "books": [{**b, "trades": b["trades"][-40:]} for b in books]}
        path.write_text(json.dumps(slim, indent=1))

    def close(b, lt, at, why):
        p = b["position"]
        side = b["side"]
        x = lt * (1 - SLIP * side)
        gross = side * (x - p["entry"]) * p["qty"]
        buy, sell = (p["entry"] * p["qty"], x * p["qty"]) if side > 0 else (x * p["qty"], p["entry"] * p["qty"])
        cost = float(scalp._cost(buy, sell, day, 1.0))
        net = gross - cost
        t = {**p, "exit": round(x, 2), "exited_at": at, "why": why, "gross_rs": round(gross, 2), "cost_rs": round(cost, 2), "net_rs": round(net, 2),
             "secs": int(at - p["entered_at"])}
        t.pop("pnl_rs", None)
        b["trades"].append(t)
        b["n"] += 1
        b["wins"] += int(net > 0)
        b["net_rs"] = round(b["net_rs"] + net, 2)
        b["gross_rs"] = round(b["gross_rs"] + gross, 2)
        b["cost_rs"] = round(b["cost_rs"] + cost, 2)
        b["position"] = None
        b["status"] = "flat"
        log(f"rule {b['rule']} exit {p['symbol']} at {x:.2f}: {why}, net {net:+.0f} (book {b['net_rs']:+.0f}, {b['n']} trades)")

    save()
    log(f"session {date}: {len(RULES)} fast rules on {len(syms)} names")
    last_save = 0.0
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 20:
            break
        if minute < 9 * 60 + 16:
            time.sleep(5)
            continue
        try:
            px, at = _ltp_all(syms)
            for s, v in px.items():
                hist[s].append((at, v))
            square = minute >= SQUARE_OFF_MIN
            # manage open positions
            for b in books:
                p = b["position"]
                if not p:
                    continue
                lt = px.get(p["symbol"])
                if lt is None:
                    continue
                side = b["side"]
                p["ltp"] = lt
                p["pnl_rs"] = round(side * (lt - p["entry"]) * p["qty"], 2)
                if square:
                    close(b, lt, at, "square-off 15:15")
                elif side * (lt - p["stop_px"]) <= 0:
                    close(b, lt, at, "stop")
                elif side * (lt - p["target_px"]) >= 0:
                    close(b, lt, at, "target")
                elif at - p["entered_at"] >= b["hold"]:
                    close(b, lt, at, "time limit")
            # new entries: the biggest qualifying move in the window, one per flat book
            if not square:
                for b in books:
                    if b["position"]:
                        continue
                    best, bestmove = None, 0.0
                    for s, h in hist.items():
                        if len(h) < 2 or s not in px:
                            continue
                        ref = None
                        for t0, p0 in h:
                            if at - t0 <= b["window"] + 2.5:
                                ref = p0
                                break
                        if ref is None or ref <= 0:
                            continue
                        mv = px[s] / ref - 1.0
                        want = b["side"] if b["kind"] == "momentum" else -b["side"]  # momentum goes with the move, fade against it
                        if want * mv >= b["move"] and abs(mv) > abs(bestmove):
                            best, bestmove = s, mv
                    if best is None:
                        continue
                    side = b["side"]
                    e = px[best] * (1 + SLIP * side)
                    q = int(BOOK // e)
                    if q < 1:
                        continue
                    b["position"] = {"symbol": best, "entry": round(e, 2), "qty": q, "entered_at": at, "move_pct": round(bestmove * 100, 2), "ltp": px[best], "pnl_rs": 0.0,
                                     "stop_px": round(e * (1 - b["stop"] * side), 2), "target_px": round(e * (1 + b["target"] * side), 2)}
                    b["status"] = "open"
                    log(f"rule {b['rule']} {'BUY' if side > 0 else 'SELL'} {best} {q} x {e:.2f} (move {bestmove * 100:+.2f}% in {b['window']}s)")
            if square and not any(b["position"] for b in books):
                state["status"] = "done"
                save()
                break
            if now - last_save >= POLL_S:
                last_save = now
                save()
        except Exception as e:  # noqa: BLE001
            log(f"error: {e}")
            time.sleep(10)
        el = time.time() - now
        if el < POLL_S:
            time.sleep(POLL_S - el)
    state["status"] = "done"
    save()
    log(f"session over: {state['summary']}")
    return state["summary"]


def report() -> dict:
    d = _dir()
    hist, today = [], None
    tday = day_to_date(live.today_ist()).isoformat()
    for p in sorted(d.glob("*.json")):
        s = json.loads(p.read_text())
        if s["day"] == tday:
            today = s
        hist.append({"day": s["day"], "status": s.get("status"), **s.get("summary", {}), "books": [{"rule": b["rule"], "name": b["name"], "net_rs": b["net_rs"], "n": b["n"], "wins": b["wins"]} for b in s["books"]]})
    return {"rules": RULES, "universe": UNIVERSE, "today": today, "days": hist}
