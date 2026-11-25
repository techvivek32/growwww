"""Manual paper trades the admin asks for by hand (outside the tested rule). Paper only: nothing here places an order.
Records live in data/manual_trades.json; tools_watch_manual.py (service mnha-manual-watch) runs the stop / market /
15:15 exits every 30 s while a trade is open; the admin can also exit from the paper page (API /live/manual/exit)."""

from __future__ import annotations

import json
import subprocess
import time

import numpy as np

from . import config, live
from .costs import trade_costs

BOOK = 500_000.0
PATH = config.DATA / "manual_trades.json"


def _load() -> list[dict]:
    return json.loads(PATH.read_text()) if PATH.exists() else []


def _save(book: list[dict]) -> None:
    PATH.write_text(json.dumps(book, indent=1))


def _slip(px: float) -> float:
    return max(3e-4, 0.5 * (0.05 if px >= 250 else 0.01) / px)


def _ist(at: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(at + 19800))


def _watch() -> None:
    try:  # the watcher exits by itself once nothing is open; starting it again is a no-op while it runs
        subprocess.run(["systemctl", "start", "mnha-manual-watch.service"], check=False, timeout=20)
    except Exception:  # noqa: BLE001
        pass


def open_trade(symbol: str, side: str, note: str = "", stop_pct: float = 0.01, book: str = "manual", watch: bool = True) -> dict:
    symbol = symbol.upper().strip()
    side = "short" if side.lower().startswith("s") else "long"
    recs = _load()
    if any(r["symbol"] == symbol and r["status"] == "open" for r in recs):
        raise ValueError(f"{symbol} is already open")
    q, at = live.ltp([symbol, "NIFTY"])
    if symbol not in q:
        raise ValueError(f"no live price for {symbol}")
    px, sd = q[symbol], (-1 if side == "short" else 1)
    entry = round(px * (1 + _slip(px) * sd), 2)
    qty = int(BOOK // entry)
    t = _ist(at)
    rec = {"day": t[:10], "book": book, "side": side, "symbol": symbol, "entry_time": t[11:], "ltp_at_entry": px, "entry": entry, "qty": qty,
           "notional": round(entry * qty, 2), "stop": round(entry * (1 - stop_pct * sd), 2),
           "stop_rule": f"{stop_pct * 100:g}% stop; exit if NIFTY moves 0.5% against from entry; square-off 15:15",
           "nifty_at_entry": q.get("NIFTY"), "status": "open", "note": note}
    recs.append(rec)
    _save(recs)
    if watch:
        _watch()
    return rec


def close_trade(symbol: str, why: str = "admin exit", entry_time: str | None = None) -> dict:
    symbol = symbol.upper().strip()
    book = _load()
    opens = [r for r in book if r["symbol"] == symbol and r["status"] == "open" and (entry_time is None or r["entry_time"] == entry_time)]
    if not opens:
        raise ValueError(f"no open manual trade in {symbol}")
    r = opens[0]
    q, at = live.ltp([symbol, "NIFTY"])
    if symbol not in q:
        raise ValueError(f"no live price for {symbol}")
    px, sd = q[symbol], (-1 if r["side"] == "short" else 1)
    x = round(px * (1 - _slip(px) * sd), 2)
    gross = (x - r["entry"]) * r["qty"] * sd
    costs = float(trade_costs(np.array([r["entry"] * r["qty"]]), np.array([x * r["qty"]]), np.array([sd]), np.array([live.today_ist()]), True)[0])
    r.update({"status": "closed", "exit": x, "exit_time": _ist(at)[11:], "why": why, "gross": round(gross, 2), "costs": round(costs, 2),
              "net": round(gross - costs, 2), "ltp_at_exit": px, "nifty_at_exit": q.get("NIFTY")})
    _save(book)
    return r
