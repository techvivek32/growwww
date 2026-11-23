"""Live scalp book (paper, no orders) — the admin's variation of the scalping program.

Rules, as asked on 23 Nov 2026:
  * the entry rules are the strategies that were positive in the 20 Nov daily run (52 of the 100; under the exit
    rule below only their signal + universe matter, so identical pairs are run once and listed together);
  * entries only at the close of the 11:05, 11:10 and 11:15 bars (signals on the 11:00-11:15 bars);
  * one position per rule, the full ₹5 lakh, the most liquid name firing on that bar;
  * exit when the position is ₹1,000 below its best point (so a fresh position stops at a ₹1,000 loss and a winner
    gives back at most ₹1,000 from its peak), or at 15:15. No target: the profit runs.
Separate from Book A / Book B (livex) and from the 100-strategy daily run (scalp.daily): its own files under
data/scalping/live/<date>.json, its own timer (mnha-scalp-live, 10:58 IST).
"""

from __future__ import annotations

import json
import time

import numpy as np
import pandas as pd

from . import config, lab, live, scalp
from .sessions import ist_day, ist_minute
from .validation import day_to_date

BOOK = 500_000.0
TRAIL_RS = 1000.0
ENTRY_BARS = (21, 22, 23)  # bar b closes at 09:20 + 5b: 11:05, 11:10, 11:15
SQUARE_OFF_MIN = 15 * 60 + 15
POLL_S = 5
SOURCE_DAY = "2026-11-20"  # the daily run whose positive strategies form the rule set
SLIP = 3e-4


def _dir():
    d = config.DATA / "scalping" / "live"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "scalp-live", msg, flush=True)


def rules() -> list[dict]:
    """Distinct (signal, universe) pairs among the strategies positive on SOURCE_DAY, with the ranks they cover."""
    d = config.DATA / "scalping"
    V = np.load(d / "top_dna.npy")
    rec = json.loads((d / "daily" / f"{SOURCE_DAY}.json").read_text())
    pos = [o["rank"] for o in rec["results"] if o["net_rs"] > 0]
    out: dict[tuple, dict] = {}
    for rank in pos:
        v = V[rank - 1]
        key = (int(v[0]), int(v[1]))
        if key not in out:
            name, kind, param, side = scalp.SIGNALS[key[0]]
            out[key] = {"signal": name, "side": "long" if side > 0 else "short", "side_n": int(side), "umax": scalp.UNIVERSES[key[1]],
                        "universe": f"top {scalp.UNIVERSES[key[1]]} by turnover", "ranks": []}
        out[key]["ranks"].append(rank)
    rs = sorted(out.values(), key=lambda r: r["ranks"][0])
    for i, r in enumerate(rs, 1):
        r["rule"] = i
    return rs


def _partial_paths(df: pd.DataFrame, day: int, upto: int) -> np.ndarray | None:
    """(5, NB) o/h/l/c/v of today's bars 0..upto (later bars NaN); missing bars carried forward; None if the
    stock has fewer than upto-2 bars so far."""
    t = df["time"].to_numpy(dtype=np.int64)
    sel = ist_day(t) == day
    b = (ist_minute(t[sel]) - config.SESSION_OPEN) // 5
    k = (b >= 0) & (b <= upto)
    if k.sum() < upto - 2 or not (b[k] == 0).any():
        return None
    arr = np.full((5, lab.NB), np.nan)
    for i, col in enumerate(("open", "high", "low", "close", "volume")):
        arr[i, b[k]] = df[col].to_numpy(dtype=float)[sel][k]
    for q in range(1, upto + 1):
        if np.isnan(arr[3, q]):
            arr[0:4, q] = arr[3, q - 1]
            arr[4, q] = 0.0
    return arr if np.isfinite(arr[3, : upto + 1]).all() else None


def _candidates(day: int, bar: int, syms: list[str], liq_rank: dict[str, int], rs: list[dict]) -> dict[int, tuple[str, float]]:
    """For each rule not yet entered: (symbol, raw close) of the most liquid name firing at `bar`, from today's bars."""
    got = live.fetch_range_day(syms, day)
    rows, keep = [], []
    for s in syms:
        df_ = got.get(s)
        if df_ is None:
            continue
        a = _partial_paths(df_, day, bar)
        if a is not None:
            rows.append(a)
            keep.append(s)
    if not rows:
        return {}
    P = np.stack(rows)
    df = pd.DataFrame({"day": day, "symbol": keep, "p_liq": [1.0 / liq_rank[s] for s in keep]})
    Ld = lab.Lab(df, P[:, 0], P[:, 1], P[:, 2], P[:, 3], P[:, 4], np.full(len(keep), day_to_date(day).year), True)
    masks = scalp.signal_masks(Ld)
    sig_ix = {s[0]: i for i, s in enumerate(scalp.SIGNALS)}
    out = {}
    for r in rs:
        m = masks[sig_ix[r["signal"]], :, bar] == 1
        best, bestliq = None, 1e300
        for j in np.flatnonzero(m):
            lr = liq_rank[keep[j]]
            if lr <= r["umax"] and lr < bestliq:
                best, bestliq = keep[j], lr
        if best is not None:
            out[r["rule"]] = (best, float(P[keep.index(best), 3, bar]))
    return out


def _cost(buy: float, sell: float, day: int) -> float:
    return float(scalp._cost(buy, sell, day, 1.0))


def session() -> dict:
    day = live.today_ist()
    date = day_to_date(day)
    if date.weekday() >= 5:
        return {"status": "weekend"}
    res = json.loads((config.DATA / "scalping" / "results.json").read_text())
    syms, liq_rank = res["universe_symbols"], res["liq_rank"]
    rs = rules()
    path = _dir() / f"{date.isoformat()}.json"
    state = {"day": date.isoformat(), "rules": len(rs), "source_day": SOURCE_DAY, "trail_rs": TRAIL_RS, "started_at": time.time(),
             "positions": [], "events": [], "status": "waiting for 11:05"}
    for r in rs:
        state["positions"].append({"rule": r["rule"], "ranks": r["ranks"], "signal": r["signal"], "side": r["side"], "universe": r["universe"],
                                   "status": "waiting", "symbol": None})
    pos_by_rule = {p["rule"]: p for p in state["positions"]}
    rule_by_id = {r["rule"]: r for r in rs}

    def save():
        state["updated_at"] = time.time()
        closed = [p for p in state["positions"] if p["status"] == "closed"]
        opened = [p for p in state["positions"] if p["status"] == "open"]
        state["summary"] = {"open": len(opened), "closed": len(closed), "no_signal": sum(p["status"] == "no signal" for p in state["positions"]),
                            "realised_rs": round(sum(p["net_rs"] for p in closed), 2), "unrealised_rs": round(sum(p.get("pnl_rs", 0.0) for p in opened), 2)}
        state["summary"]["total_rs"] = round(state["summary"]["realised_rs"] + state["summary"]["unrealised_rs"], 2)
        path.write_text(json.dumps(state, indent=1))

    save()
    log(f"session {date}: {len(rs)} rules from {SOURCE_DAY}; waiting for the 11:05 bar")
    done_bars: set[int] = set()
    last_poll = 0.0
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 30:
            break
        try:
            # entries: once per bar in the window, 10 s after the bar closes
            for b in ENTRY_BARS:
                close_min = 9 * 60 + 20 + 5 * b
                if b in done_bars or minute < close_min + 10 / 60 or minute > close_min + 4.5:
                    continue
                done_bars.add(b)
                pending = [rule_by_id[r] for r, p in pos_by_rule.items() if p["status"] == "waiting"]
                if not pending:
                    continue
                state["status"] = f"scanning the {close_min // 60:02d}:{close_min % 60:02d} bar"
                cands = _candidates(day, b, syms, liq_rank, pending)
                for rid, (sym, raw) in cands.items():
                    p = pos_by_rule[rid]
                    side = rule_by_id[rid]["side_n"]
                    e = raw * (1 + SLIP * side)
                    q = int(BOOK // e)
                    if q < 1:
                        continue
                    p.update({"status": "open", "symbol": sym, "entry_bar": f"{close_min // 60:02d}:{close_min % 60:02d}", "entry_raw": raw,
                              "entry": round(e, 2), "qty": q, "entered_at": time.time(), "ltp": raw, "pnl_rs": 0.0, "peak_rs": 0.0})
                    state["events"].append({"at": time.time(), "what": f"rule {rid} {p['side'].upper()} {sym} {q} x {e:.2f} ({p['signal']} at {p['entry_bar']})"})
                    log(state["events"][-1]["what"])
                if b == ENTRY_BARS[-1]:
                    for p in state["positions"]:
                        if p["status"] == "waiting":
                            p["status"] = "no signal"
                    state["status"] = "window closed; managing positions"
                save()
            # management: every 5 s, the ₹1,000 trail from the peak; square-off at 15:15
            opened = [p for p in state["positions"] if p["status"] == "open"]
            if opened and now - last_poll >= POLL_S:
                last_poll = now
                px, at = live.ltp(sorted({p["symbol"] for p in opened}))
                square = minute >= SQUARE_OFF_MIN
                for p in opened:
                    lt = px.get(p["symbol"])
                    if lt is None:
                        continue
                    side = 1 if p["side"] == "long" else -1
                    pnl = side * (lt - p["entry"]) * p["qty"]
                    p["ltp"], p["pnl_rs"], p["peak_rs"] = lt, round(pnl, 2), round(max(p["peak_rs"], pnl), 2)
                    if square or pnl <= p["peak_rs"] - TRAIL_RS:
                        x = lt * (1 - SLIP * side)
                        gross = side * (x - p["entry"]) * p["qty"]
                        buy, sell = (p["entry"] * p["qty"], x * p["qty"]) if side > 0 else (x * p["qty"], p["entry"] * p["qty"])
                        cost = _cost(buy, sell, day)
                        p.update({"status": "closed", "exit": round(x, 2), "exited_at": at, "why": "square-off 15:15" if square else ("stop ₹1,000" if p["peak_rs"] < 1 else "trail ₹1,000 from peak"),
                                  "gross_rs": round(gross, 2), "cost_rs": round(cost, 2), "net_rs": round(gross - cost, 2)})
                        state["events"].append({"at": at, "what": f"rule {p['rule']} exit {p['symbol']} at {x:.2f}: {p['why']}, net {gross - cost:+.0f}"})
                        log(state["events"][-1]["what"])
                if square:
                    state["status"] = "done"
                save()
            if minute >= SQUARE_OFF_MIN + 1 and not [p for p in state["positions"] if p["status"] == "open"] and len(done_bars) == len(ENTRY_BARS):
                state["status"] = "done"
                save()
                break
        except Exception as e:  # noqa: BLE001  keep the day alive; the next loop retries
            log(f"error: {e}")
            state["events"].append({"at": time.time(), "what": f"error: {e}"})
            save()
            time.sleep(15)
        time.sleep(1)
    state["status"] = "done" if state["status"] != "waiting for 11:05" else "no entries (session ended)"
    save()
    log(f"session {date} over: {state['summary']}")
    return state["summary"]


def report() -> dict:
    d = _dir()
    days = sorted(d.glob("*.json"))
    hist = []
    today = None
    tday = day_to_date(live.today_ist()).isoformat()
    for p in days:
        s = json.loads(p.read_text())
        if s["day"] == tday:
            today = s
        hist.append({"day": s["day"], "status": s.get("status"), **s.get("summary", {})})
    return {"rules": rules() if (config.DATA / "scalping" / "daily" / f"{SOURCE_DAY}.json").exists() else [], "trail_rs": TRAIL_RS,
            "window": "11:05, 11:10, 11:15 bar closes", "today": today, "days": hist}
