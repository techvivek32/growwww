"""Live scalp book (paper, no orders): the scalping strategies that were positive in BOTH the selection window
(2024-01..2026-04) and the test months (2026-05 on) of the 1-lakh search, run on today's market.

Each strategy trades its own rule: its signal, universe, entry window, stop, target and maximum hold (one position per
strategy per day, the full ₹5 lakh, the most liquid name firing on the bar). Entries at bar closes (10 s after),
the stop / target / hold checked on the LTP every 5 s, everything squared off at 15:15.
Separate from Book A / Book B (livex) and from the 100-strategy daily replay (scalp.daily): own files under
data/scalping/live/<date>.json, own timer (mnha-scalp-live, 09:18 IST).

History: on 23 Nov the first version ran the admin's rule (52 one-day winners, 11:00-11:15 entries, ₹1,000 trail) and
lost ₹8,778 in five minutes: every position stopped on noise. That day's file is kept as the record.
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
SQUARE_OFF_MIN = 15 * 60 + 15
POLL_S = 5
SLIP = 3e-4
MAX_RULES = 30


def _dir():
    d = config.DATA / "scalping" / "live"
    d.mkdir(parents=True, exist_ok=True)
    return d


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "scalp-live", msg, flush=True)


def _bar_hm(b: int) -> str:
    m = 9 * 60 + 20 + 5 * b
    return f"{m // 60:02d}:{m % 60:02d}"


def rules() -> list[dict]:
    """The search's top strategies that are positive in both windows, one per distinct rule (trades/day ignored:
    live takes one position per strategy per day)."""
    d = config.DATA / "scalping"
    res = json.loads((d / "results.json").read_text())
    V = np.load(d / "top_dna.npy")
    seen, out = set(), []
    for r in res["top"]:
        s, t = r["selection_2024_01_to_2026_04"], r["test_2026_05_on"]
        if s["net_rs"] <= 0 or t["net_rs"] <= 0:
            continue
        key = (r["signal"], r["universe"], r["window"], r["stop_pct"], r["target_pct"], r["max_hold_min"])
        if key in seen:
            continue
        seen.add(key)
        v = V[r["rank"] - 1]
        name, kind, param, side = scalp.SIGNALS[int(v[0])]
        w0, w1 = scalp.WINDOWS[int(v[2])]
        out.append({"rule": len(out) + 1, "rank": r["rank"], "signal": name, "side": "long" if side > 0 else "short", "side_n": int(side),
                    "umax": scalp.UNIVERSES[int(v[1])], "universe": r["universe"], "window": r["window"], "w0": int(w0), "w1": int(w1),
                    "stop": scalp.STOPS[int(v[3])], "target": scalp.TARGETS[int(v[4])], "hold_bars": int(scalp.HOLDS[int(v[5])]),
                    "stop_pct": r["stop_pct"], "target_pct": r["target_pct"], "max_hold_min": r["max_hold_min"],
                    "selection_per_month_pct": s["per_month_pct"], "test_per_month_pct": t["per_month_pct"]})
        if len(out) >= MAX_RULES:
            break
    return out


def _partial_paths(df: pd.DataFrame, day: int, upto: int) -> np.ndarray | None:
    """(5, NB) o/h/l/c/v of today's bars 0..upto (later bars NaN); missing bars carried forward; None if the
    stock has fewer than upto-2 bars so far."""
    t = df["time"].to_numpy(dtype=np.int64)
    sel = ist_day(t) == day
    b = (ist_minute(t[sel]) - config.SESSION_OPEN) // 5
    k = (b >= 0) & (b <= upto)
    if k.sum() < max(1, upto - 2) or not (b[k] == 0).any():
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
    """For each rule given: (symbol, raw close) of the most liquid name firing at `bar`, from today's bars."""
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


def session(bars: tuple[int, ...] | None = None) -> dict:
    """The day loop. `bars` restricts the entry bars (a late start); otherwise each rule's own window applies."""
    day = live.today_ist()
    date = day_to_date(day)
    if date.weekday() >= 5:
        return {"status": "weekend"}
    res = json.loads((config.DATA / "scalping" / "results.json").read_text())
    syms, liq_rank = res["universe_symbols"], res["liq_rank"]
    rs = rules()
    by_rule = {r["rule"]: r for r in rs}
    all_bars = sorted({b for r in rs for b in range(r["w0"], r["w1"] + 1)} & (set(bars) if bars else set(range(lab.NB))))
    path = _dir() / f"{date.isoformat()}.json"
    state = {"day": date.isoformat(), "rules": len(rs), "started_at": time.time(), "version": 2,
             "window": f"{_bar_hm(all_bars[0])}–{_bar_hm(all_bars[-1])} bar closes" if all_bars else "none",
             "positions": [], "events": [], "status": f"waiting for {_bar_hm(all_bars[0])}" if all_bars else "no entry bars today"}
    for r in rs:
        state["positions"].append({k: r[k] for k in ("rule", "rank", "signal", "side", "universe", "window", "stop_pct", "target_pct", "max_hold_min",
                                                      "selection_per_month_pct", "test_per_month_pct")} | {"status": "waiting", "symbol": None})
    pos = {p["rule"]: p for p in state["positions"]}

    def save():
        state["updated_at"] = time.time()
        closed = [p for p in state["positions"] if p["status"] == "closed"]
        opened = [p for p in state["positions"] if p["status"] == "open"]
        state["summary"] = {"open": len(opened), "closed": len(closed), "no_signal": sum(p["status"] == "no signal" for p in state["positions"]),
                            "realised_rs": round(sum(p["net_rs"] for p in closed), 2), "unrealised_rs": round(sum(p.get("pnl_rs", 0.0) for p in opened), 2)}
        state["summary"]["total_rs"] = round(state["summary"]["realised_rs"] + state["summary"]["unrealised_rs"], 2)
        path.write_text(json.dumps(state, indent=1))

    def close(p, lt, at, why):
        side = 1 if p["side"] == "long" else -1
        x = lt * (1 - SLIP * side)
        gross = side * (x - p["entry"]) * p["qty"]
        buy, sell = (p["entry"] * p["qty"], x * p["qty"]) if side > 0 else (x * p["qty"], p["entry"] * p["qty"])
        cost = _cost(buy, sell, day)
        p.update({"status": "closed", "exit": round(x, 2), "exited_at": at, "why": why, "gross_rs": round(gross, 2), "cost_rs": round(cost, 2),
                  "net_rs": round(gross - cost, 2)})
        state["events"].append({"at": at, "what": f"rule {p['rule']} exit {p['symbol']} at {x:.2f}: {why}, net {gross - cost:+.0f}"})
        log(state["events"][-1]["what"])

    save()
    log(f"session {date}: {len(rs)} rules; entry bars {state['window']}")
    done_bars: set[int] = set()
    last_poll = 0.0
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 30:
            break
        try:
            for b in all_bars:
                close_min = 9 * 60 + 20 + 5 * b
                if b in done_bars or minute < close_min + 10 / 60:
                    continue
                done_bars.add(b)
                if minute > close_min + 4.5:
                    continue  # that bar is history (late start); its window may still have later bars
                pending = [by_rule[k] for k, p in pos.items() if p["status"] == "waiting" and by_rule[k]["w0"] <= b <= by_rule[k]["w1"]]
                if not pending:
                    continue
                state["status"] = f"scanning the {_bar_hm(b)} bar ({len(pending)} rules waiting)"
                save()
                cands = _candidates(day, b, syms, liq_rank, pending)
                for rid, (sym, raw) in cands.items():
                    p, r = pos[rid], by_rule[rid]
                    side = r["side_n"]
                    e = raw * (1 + SLIP * side)
                    q = int(BOOK // e)
                    if q < 1:
                        continue
                    p.update({"status": "open", "symbol": sym, "entry_bar": _bar_hm(b), "entry_raw": raw, "entry": round(e, 2), "qty": q,
                              "entered_at": time.time(), "ltp": raw, "pnl_rs": 0.0, "peak_rs": 0.0,
                              "stop_px": round(e * (1 - r["stop"] * side), 2), "target_px": round(e * (1 + r["target"] * side), 2),
                              "exit_by": _bar_hm(min(b + r["hold_bars"], lab.NB - 1)), "exit_by_min": 9 * 60 + 20 + 5 * min(b + r["hold_bars"], lab.NB - 1)})
                    state["events"].append({"at": time.time(), "what": f"rule {rid} {p['side'].upper()} {sym} {q} x {e:.2f} ({r['signal']} at {_bar_hm(b)}; stop {p['stop_px']}, target {p['target_px']}, by {p['exit_by']})"})
                    log(state["events"][-1]["what"])
                for k, p in pos.items():
                    if p["status"] == "waiting" and by_rule[k]["w1"] <= b:
                        p["status"] = "no signal"
                state["status"] = "managing positions" if any(p["status"] == "open" for p in state["positions"]) else "waiting for signals"
                save()
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
                    if square:
                        close(p, lt, at, "square-off 15:15")
                    elif side * (lt - p["stop_px"]) <= 0:
                        close(p, lt, at, f"stop {p['stop_pct']}%")
                    elif side * (lt - p["target_px"]) >= 0:
                        close(p, lt, at, f"target {p['target_pct']}%")
                    elif minute >= p["exit_by_min"]:
                        close(p, lt, at, f"max hold {p['max_hold_min']} min")
                save()
            if minute >= SQUARE_OFF_MIN + 1 and not [p for p in state["positions"] if p["status"] == "open"]:
                for p in state["positions"]:
                    if p["status"] == "waiting":
                        p["status"] = "no signal"
                state["status"] = "done"
                save()
                break
        except Exception as e:  # noqa: BLE001  keep the day alive; the next loop retries
            log(f"error: {e}")
            state["events"].append({"at": time.time(), "what": f"error: {e}"})
            save()
            time.sleep(15)
        time.sleep(1)
    if state["status"] != "done":
        state["status"] = "done"
        save()
    log(f"session {date} over: {state['summary']}")
    return state["summary"]


def report() -> dict:
    d = _dir()
    hist, today = [], None
    tday = day_to_date(live.today_ist()).isoformat()
    for p in sorted(d.glob("*.json")):
        s = json.loads(p.read_text())
        if s["day"] == tday:
            today = s
        hist.append({"day": s["day"], "status": s.get("status"), "rules": s.get("rules"), "version": s.get("version", 1), **s.get("summary", {})})
    rs = rules() if (config.DATA / "scalping" / "results.json").exists() else []
    return {"rules": rs, "window": "each strategy's own entry window, 09:25–13:00 bar closes", "today": today, "days": hist}
