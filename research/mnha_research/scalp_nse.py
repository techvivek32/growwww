"""NSE-context scalp book (paper, no orders): the admin's two NSE pages as the scalping input (23 Nov 2026).

Sources (nseindia.com, refreshed every minute while the market is open):
  * top gainers / losers: https://www.nseindia.com/market-data/top-gainers-losers  (symbol, open/high/low/ltp,
    % change, turnover, nearWKH / nearWKL = distance from the 52-week high / low)
  * live equity market: https://www.nseindia.com/market-data/live-equity-market  (the index-wide JSON is blocked
    for servers; the 52-week fields it shows come with the gainers/losers rows above)

Four selective rules, each at most 2 trades a day ("wait for your turn"), ₹5 lakh a trade, entries 09:30–14:30,
squared off 15:15, Groww costs and slippage on every trade:
  1. gainer continuation BUY: a top gainer (+3% or more, within 5% of its 52-week high) that pulled back 0.5%+ from
     the day's high and then makes a new 2-minute high. Target +1%, stop −0.5%, 30 min.
  2. loser continuation SELL: the mirror on a top loser. Target 1%, stop 0.5%, 30 min.
  3. 52-week-high breakout BUY: a gainer within 0.5% of its 52-week high that takes out the day's high. Target 1%,
     stop 0.5%, 45 min.
  4. exhausted gainer fade SELL: a gainer up 8%+ that drops 1%+ from the day's high within 2 minutes. Target 1%,
     stop 0.6%, 30 min.
Files: data/scalping/nse/<date>.json. Separate from Book A/B and the other scalp books.
"""

from __future__ import annotations

import json
import time
from collections import deque

import requests

from . import config, live, scalp
from .validation import day_to_date

BOOK = 500_000.0
POLL_S = 5
NSE_EVERY_S = 60
SLIP = 3e-4
ENTRY_FROM, ENTRY_TO, SQUARE_OFF_MIN = 9 * 60 + 30, 14 * 60 + 30, 15 * 60 + 15
MIN_TURNOVER_RS = 5e7  # ₹5 crore traded so far, so ₹5 lakh is a small part of the day
MIN_PRICE = 20.0
MAX_TRADES = 2
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
RULES = [
    {"rule": 1, "name": "gainer continuation (pullback, new high)", "side": 1, "target": 0.01, "stop": 0.005, "hold": 1800},
    {"rule": 2, "name": "loser continuation (bounce, new low)", "side": -1, "target": 0.01, "stop": 0.005, "hold": 1800},
    {"rule": 3, "name": "52-week-high breakout", "side": 1, "target": 0.01, "stop": 0.005, "hold": 2700},
    {"rule": 4, "name": "exhausted gainer fade (8%+, drops 1% from high)", "side": -1, "target": 0.01, "stop": 0.006, "hold": 1800},
]


def _dir():
    d = config.DATA / "scalping" / "nse"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "scalp-nse", msg, flush=True)


def _rs(s: str) -> float:
    s = str(s).replace(",", "").strip()
    try:
        if s.endswith("Cr"):
            return float(s[:-2]) * 1e7
        if s.endswith("L"):
            return float(s[:-1]) * 1e5
        return float(s)
    except ValueError:
        return 0.0


class Nse:
    def __init__(self):
        self.s = requests.Session()
        self.h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9",
                  "Referer": "https://www.nseindia.com/market-data/top-gainers-losers"}

    def movers(self) -> dict[str, dict]:
        """symbol -> row for today's top gainers and losers (all securities and F&O lists merged), liquid names only."""
        out: dict[str, dict] = {}
        for kind in ("gainers", "loosers"):
            r = self.s.get("https://www.nseindia.com/api/live-analysis-variations", params={"index": kind}, headers=self.h, timeout=20)
            r.raise_for_status()
            d = r.json()
            for lst in ("allSec", "FOSec", "SecGtr20"):
                for x in d.get(lst, {}).get("data", []):
                    sym = x.get("symbol")
                    if not sym or x.get("series") != "EQ" or "-" in sym or "&" in sym:
                        continue
                    row = {"symbol": sym, "kind": "gainer" if kind == "gainers" else "loser", "pct": float(x.get("perChange") or 0),
                           "ltp": float(x.get("ltp") or 0), "high": float(x.get("high_price") or 0), "low": float(x.get("low_price") or 0),
                           "open": float(x.get("open_price") or 0), "prev": float(x.get("prev_price") or 0),
                           "near_wkh": float(x.get("nearWKH") or 999), "near_wkl": float(x.get("nearWKL") or -999), "turnover": _rs(x.get("turnover", "0"))}
                    if row["ltp"] >= MIN_PRICE and row["turnover"] >= MIN_TURNOVER_RS:
                        out[sym] = row
        return out


def session() -> dict:
    day = live.today_ist()
    date = day_to_date(day)
    if date.weekday() >= 5:
        return {"status": "weekend"}
    nse = Nse()
    path = _dir() / f"{date.isoformat()}.json"
    books = [{**r, "position": None, "trades": [], "net_rs": 0.0, "cost_rs": 0.0, "n": 0, "wins": 0} for r in RULES]
    state = {"day": date.isoformat(), "started_at": time.time(), "status": "watching NSE movers", "books": books, "movers": [], "watch": 0, "events": []}
    hist: dict[str, deque] = {}  # symbol -> (t, ltp) last ~5 min
    seen_pullback: dict[str, float] = {}  # symbol -> time a 0.5% pullback/bounce from the day's extreme was last seen
    movers: dict[str, dict] = {}
    last_nse, last_save = 0.0, 0.0

    def save():
        state["updated_at"] = time.time()
        state["summary"] = {"total_rs": round(sum(b["net_rs"] for b in books) + sum(b["position"]["pnl_rs"] for b in books if b["position"]), 2),
                            "realised_rs": round(sum(b["net_rs"] for b in books), 2), "trades": sum(b["n"] for b in books), "open": sum(1 for b in books if b["position"])}
        state["watch"] = len(movers)
        state["movers"] = sorted(movers.values(), key=lambda r: -abs(r["pct"]))[:40]
        state["events"] = state["events"][-60:]
        path.write_text(json.dumps(state, indent=1))

    def event(what: str):
        state["events"].append({"at": time.time(), "what": what})
        log(what)

    def close(b, lt, at, why):
        p, side = b["position"], b["side"]
        x = lt * (1 - SLIP * side)
        gross = side * (x - p["entry"]) * p["qty"]
        buy, sell = (p["entry"] * p["qty"], x * p["qty"]) if side > 0 else (x * p["qty"], p["entry"] * p["qty"])
        cost = float(scalp._cost(buy, sell, day, 1.0))
        net = gross - cost
        t = {k: v for k, v in p.items() if k != "pnl_rs"} | {"exit": round(x, 2), "exited_at": at, "why": why, "gross_rs": round(gross, 2), "cost_rs": round(cost, 2),
                                                             "net_rs": round(net, 2), "secs": int(at - p["entered_at"])}
        b["trades"].append(t)
        b["n"] += 1
        b["wins"] += int(net > 0)
        b["net_rs"] = round(b["net_rs"] + net, 2)
        b["cost_rs"] = round(b["cost_rs"] + cost, 2)
        b["position"] = None
        event(f"rule {b['rule']} exit {p['symbol']} at {x:.2f}: {why}, net {net:+.0f}")

    def open_(b, sym, lt, at, why):
        side = b["side"]
        e = lt * (1 + SLIP * side)
        q = int(BOOK // e)
        if q < 1:
            return
        b["position"] = {"symbol": sym, "entry": round(e, 2), "qty": q, "entered_at": at, "ltp": lt, "pnl_rs": 0.0, "why_in": why,
                         "stop_px": round(e * (1 - b["stop"] * side), 2), "target_px": round(e * (1 + b["target"] * side), 2),
                         "day_pct": movers.get(sym, {}).get("pct"), "near_wkh": movers.get(sym, {}).get("near_wkh")}
        seen_pullback.pop(sym, None)
        event(f"rule {b['rule']} {'BUY' if side > 0 else 'SELL'} {sym} {q} x {e:.2f}: {why}")

    save()
    log(f"session {date}: NSE movers scalp, {len(RULES)} rules")
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 20:
            break
        if minute < 9 * 60 + 20:
            time.sleep(10)
            continue
        try:
            if now - last_nse >= NSE_EVERY_S:
                try:
                    fresh = nse.movers()
                    movers.update(fresh)  # a name stays on the watch after it drops off the list
                    last_nse = now
                except Exception as e:  # noqa: BLE001
                    event(f"NSE fetch failed: {e}")
                    last_nse = now - NSE_EVERY_S + 20
            syms = sorted(set(movers) | {b["position"]["symbol"] for b in books if b["position"]})
            px: dict[str, float] = {}
            for i in range(0, len(syms), 50):
                p_, _ = live.ltp(syms[i : i + 50])
                px.update(p_)
            at = time.time()
            for s, v in px.items():
                hist.setdefault(s, deque(maxlen=70)).append((at, v))
                m = movers.get(s)
                if m:
                    m["high"] = max(m["high"], v)
                    m["low"] = min(m["low"], v) if m["low"] > 0 else v
                    m["ltp"] = v
                    if m["kind"] == "gainer" and m["high"] > 0 and (m["high"] - v) / m["high"] >= 0.005:
                        seen_pullback[s] = at
                    if m["kind"] == "loser" and m["low"] > 0 and (v - m["low"]) / m["low"] >= 0.005:
                        seen_pullback[s] = at
            square = minute >= SQUARE_OFF_MIN
            for b in books:
                p = b["position"]
                if not p or p["symbol"] not in px:
                    continue
                lt, side = px[p["symbol"]], b["side"]
                p["ltp"], p["pnl_rs"] = lt, round(side * (lt - p["entry"]) * p["qty"], 2)
                if square:
                    close(b, lt, at, "square-off 15:15")
                elif side * (lt - p["stop_px"]) <= 0:
                    close(b, lt, at, f"stop {b['stop'] * 100:g}%")
                elif side * (lt - p["target_px"]) >= 0:
                    close(b, lt, at, f"target {b['target'] * 100:g}%")
                elif at - p["entered_at"] >= b["hold"]:
                    close(b, lt, at, "time limit")
            if ENTRY_FROM <= minute <= ENTRY_TO:
                held = {b["position"]["symbol"] for b in books if b["position"]}
                for b in books:
                    if b["position"] or b["n"] >= MAX_TRADES:
                        continue
                    for s, m in movers.items():
                        if s in held or s not in px or len(hist.get(s, ())) < 12:
                            continue
                        h = hist[s]
                        lt = px[s]
                        prev = [v for t0, v in h if at - t0 <= 120 and t0 < at]
                        if len(prev) < 6:
                            continue
                        hi2, lo2 = max(prev), min(prev)
                        pulled = s in seen_pullback and at - seen_pullback[s] <= 600
                        if b["rule"] == 1 and m["kind"] == "gainer" and m["pct"] >= 3 and m["near_wkh"] <= 5 and pulled and lt >= hi2 and lt > prev[-1]:
                            open_(b, s, lt, at, f"gainer +{m['pct']:.1f}%, {m['near_wkh']:.1f}% from 52W high, pulled back then new 2-min high")
                        elif b["rule"] == 2 and m["kind"] == "loser" and m["pct"] <= -3 and pulled and lt <= lo2 and lt < prev[-1]:
                            open_(b, s, lt, at, f"loser {m['pct']:.1f}%, bounced then new 2-min low")
                        elif b["rule"] == 3 and m["kind"] == "gainer" and m["near_wkh"] <= 0.5 and lt >= m["high"] and lt > prev[-1] and lt >= hi2:
                            open_(b, s, lt, at, f"gainer +{m['pct']:.1f}% at its 52W high, taking out the day's high")
                        elif b["rule"] == 4 and m["kind"] == "gainer" and m["pct"] >= 8 and m["high"] > 0 and (m["high"] - lt) / m["high"] >= 0.01 and lt < lo2 and (hi2 - lt) / hi2 >= 0.01:
                            open_(b, s, lt, at, f"gainer +{m['pct']:.1f}% exhausted: {100 * (m['high'] - lt) / m['high']:.1f}% off the high in 2 min")
                        else:
                            continue
                        held.add(s)
                        break
            state["status"] = "done" if square and not any(b["position"] for b in books) else ("square-off" if square else "watching NSE movers")
            if now - last_save >= POLL_S or state["status"] == "done":
                last_save = now
                save()
            if state["status"] == "done":
                break
        except Exception as e:  # noqa: BLE001
            event(f"error: {e}")
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
    return {"rules": RULES, "max_trades": MAX_TRADES, "today": today, "days": hist}
