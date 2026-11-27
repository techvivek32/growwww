"""Active (automatic) and manual (the admin's) paper trades. Paper only: nothing here places an order.
Records live in data/manual_trades.json. Every change is a locked read-modify-write (fcntl lock on a sidecar file) with
an atomic rename, so the API, the active book and the watcher never undo each other's updates. `watch()` (service
mnha-manual-watch, `python -m mnha_research manual-watch`) runs the stop / market / 15:15 exits of the MANUAL trades
every 30 s while one is open; the active book manages its own; the admin can exit any from the page (/live/manual/exit)."""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import subprocess
import tempfile
import time

import numpy as np

from . import config, live
from .costs import trade_costs

BOOK = 500_000.0
PATH = config.DATA / "manual_trades.json"


def _load() -> list[dict]:
    """The records; a read that lands mid-write by an older writer is retried once."""
    if not PATH.exists():
        return []
    try:
        return json.loads(PATH.read_text())
    except json.JSONDecodeError:
        time.sleep(0.1)
        return json.loads(PATH.read_text())


@contextlib.contextmanager
def _locked():
    """Exclusive lock around a read-modify-write of the records (all writers take it; readers need not)."""
    PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PATH.with_suffix(".lock"), "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _save(book: list[dict]) -> None:
    """Atomic: a uniquely named temporary file next to it, then a rename, so a reader never sees half a file and two
    writers never collide on one temporary name. Call it under _locked()."""
    fd, tmp = tempfile.mkstemp(dir=PATH.parent, prefix=".manual_trades.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(json.dumps(book, indent=1))
        os.replace(tmp, PATH)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


def update_open(symbol: str, book: str, fields: dict) -> None:
    """Merge `fields` into the open record of `symbol` in `book`, under the lock."""
    with _locked():
        recs = _load()
        for r in recs:
            if r["symbol"] == symbol and r["status"] == "open" and r.get("book", "manual") == book:
                r.update(fields)
        _save(recs)


def _slip(px: float) -> float:
    return max(3e-4, 0.5 * (0.05 if px >= 250 else 0.01) / px)


def _ist(at: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(at + 19800))


def _watch() -> None:
    try:  # the watcher exits by itself once nothing is open; starting it again is a no-op while it runs
        subprocess.run(["systemctl", "start", "mnha-manual-watch.service"], check=False, timeout=20)
    except Exception:  # noqa: BLE001
        pass


def open_trade(symbol: str, side: str, note: str = "", stop_pct: float = 0.01, book: str = "manual", watch: bool = True,
               value: float = BOOK) -> dict:
    """Open a paper trade at the live price: `value` rupees (₹5L by default), the stop `stop_pct` away."""
    symbol = symbol.upper().strip()
    side = "short" if side.lower().startswith("s") else "long"
    if any(r["symbol"] == symbol and r["status"] == "open" for r in _load()):
        raise ValueError(f"{symbol} is already open")
    q, at = live.ltp([symbol, "NIFTY"])  # the quote outside the lock: a slow call never holds the other writers
    if symbol not in q:
        raise ValueError(f"no live price for {symbol}")
    px, sd = q[symbol], (-1 if side == "short" else 1)
    entry = round(px * (1 + _slip(px) * sd), 2)
    qty = int(value // entry)
    t = _ist(at)
    rec = {"day": t[:10], "book": book, "side": side, "symbol": symbol, "entry_time": t[11:], "ltp_at_entry": px, "entry": entry, "qty": qty,
           "notional": round(entry * qty, 2), "stop": round(entry * (1 - stop_pct * sd), 2),
           "stop_rule": f"{stop_pct * 100:g}% stop; exit if NIFTY moves 0.5% against from entry; square-off 15:15",
           "nifty_at_entry": q.get("NIFTY"), "status": "open", "note": note}
    with _locked():
        recs = _load()
        if any(r["symbol"] == symbol and r["status"] == "open" for r in recs):
            raise ValueError(f"{symbol} is already open")
        recs.append(rec)
        _save(recs)
    if watch:
        _watch()
    return rec


def _match(r: dict, symbol: str, entry_time: str | None) -> bool:
    return r["symbol"] == symbol and r["status"] == "open" and (entry_time is None or r["entry_time"] == entry_time)


def _close_at(symbol: str, entry_time: str | None, px: float, nifty: float | None, at: float, why: str) -> dict:
    """Close the open record at the quoted price, under the lock, re-reading the file so no other update is lost."""
    with _locked():
        recs = _load()
        opens = [r for r in recs if _match(r, symbol, entry_time)]
        if not opens:
            raise ValueError(f"no open trade in {symbol}")
        r = opens[0]
        sd = -1 if r["side"] == "short" else 1
        x = round(px * (1 - _slip(px) * sd), 2)
        gross = (x - r["entry"]) * r["qty"] * sd
        costs = float(trade_costs(np.array([r["entry"] * r["qty"]]), np.array([x * r["qty"]]), np.array([sd]), np.array([live.today_ist()]), True)[0])
        r.update({"status": "closed", "exit": x, "exit_time": _ist(at)[11:], "why": why, "gross": round(gross, 2), "costs": round(costs, 2),
                  "net": round(gross - costs, 2), "ltp_at_exit": px, "nifty_at_exit": nifty})
        _save(recs)
        return r


def close_trade(symbol: str, why: str = "admin exit", entry_time: str | None = None) -> dict:
    symbol = symbol.upper().strip()
    if not any(_match(r, symbol, entry_time) for r in _load()):
        raise ValueError(f"no open trade in {symbol}")
    q, at = live.ltp([symbol, "NIFTY"])  # outside the lock
    if symbol not in q:
        raise ValueError(f"no live price for {symbol}")
    return _close_at(symbol, entry_time, q[symbol], q.get("NIFTY"), at, why)


def watch() -> dict:
    """The manual trades' exits, every 30 s while one is open: a short is covered on its stop, on a 0.5% NIFTY rebound
    from entry, or at 15:15; a long is sold on its stop, on a 0.5% NIFTY drop, or at 15:15. Active trades are left to
    active.py. Returns when nothing manual is open."""
    closed = 0
    while True:
        opens = [r for r in _load() if r["status"] == "open" and r.get("book", "manual") != "active"]
        if not opens:
            break
        minute = live.minute_ist()
        try:
            q, at = live.ltp(sorted({r["symbol"] for r in opens} | {"NIFTY"}))
        except Exception as e:  # noqa: BLE001
            print(time.strftime("%H:%M:%S"), "ltp failed", e, flush=True)
            time.sleep(30)
            continue
        nif = q.get("NIFTY")
        for r in opens:
            px = q.get(r["symbol"])
            if px is None:
                continue
            sd = -1 if r["side"] == "short" else 1
            why = None
            if (sd < 0 and px >= r["stop"]) or (sd > 0 and px <= r["stop"]):
                why = "stop"
            elif nif and r.get("nifty_at_entry") and ((sd < 0 and nif >= r["nifty_at_entry"] * 1.005) or (sd > 0 and nif <= r["nifty_at_entry"] * 0.995)):
                why = "market moved 0.5% against"
            elif minute >= 15 * 60 + 15:
                why = "square-off 15:15"
            print(time.strftime("%H:%M:%S"), f"{r['side']} {r['symbol']} {px} nifty {nif} running {(px - r['entry']) * r['qty'] * sd:+.0f}", flush=True)
            if why:
                try:
                    c = _close_at(r["symbol"], r["entry_time"], px, nif, at, why)
                    closed += 1
                    print("CLOSED", json.dumps(c), flush=True)
                except ValueError:
                    pass  # closed meanwhile (the admin's Exit): nothing to do
        time.sleep(30)
    print("all closed", flush=True)
    return {"closed": closed}
