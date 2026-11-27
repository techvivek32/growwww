"""F&O PAPER trades that mirror Book A's legs in futures or bought options (the owner's request, 27 Nov 2026).
NO ORDER IS EVER SENT FROM HERE: records live in data/fno_paper.json, priced from Groww's FNO quotes.

Instruments: the near-month contract of the stock from Groww's public instrument list (cached daily in data/).
  FUT    long or short futures, lots = Book A's ₹5L / (price × lot size), at least 1. This is the same exposure as the cash leg.
  CE/PE  BUY 1 lot of the at-the-money call (for a long) or put (for a short). The most it can lose is the premium.
  Options are never sold here: a sold option's loss has no limit.
Exits: `squareoff` closes every open record at the live price (15:15, like Book A); `close` closes one by hand.
Fills: futures pay max(3 bps, half a ₹0.05 tick) a side; options pay max(₹0.05, 0.5% of the premium), as their spreads are wider.
Charges (2024-26 NSE / SEBI rates; brokerage ₹20 an order, GST 18% on brokerage + exchange charges):
  futures  STT 0.02% on the sell, exchange 0.00173%, SEBI 0.0001%, stamp 0.002% on the buy;
  options  STT 0.1% of the premium on the sell, exchange 0.03503%, SEBI 0.0001%, stamp 0.003% on the buy."""

from __future__ import annotations

import contextlib
import csv
import datetime as dt
import fcntl
import json
import os
import tempfile
import time
import urllib.request

from . import config, live
from .groww import Groww

BOOK = 500_000.0
PATH = config.DATA / "fno_paper.json"
INSTR = config.DATA / "groww_instruments.csv"
INSTR_URL = "https://growwapi-assets.groww.in/instruments/instrument.csv"
RATES = {"FUT": {"stt_sell": 2e-4, "exch": 1.73e-5, "stamp_buy": 2e-5},
         "OPT": {"stt_sell": 1e-3, "exch": 3.503e-4, "stamp_buy": 3e-5}}
SEBI, GST, BROKERAGE = 1e-6, 0.18, 20.0


def _ist(at: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(at + config.IST_OFFSET_S))


def charges(kind: str, buy_value: float, sell_value: float) -> float:
    """₹ charges of one round trip (one buy, one sell order) in futures (FUT) or options (CE / PE, on premium values)."""
    r = RATES["FUT" if kind == "FUT" else "OPT"]
    turnover = buy_value + sell_value
    exch = r["exch"] * turnover
    return (2 * BROKERAGE + r["stt_sell"] * sell_value + exch + SEBI * turnover + r["stamp_buy"] * buy_value
            + GST * (2 * BROKERAGE + exch + SEBI * turnover))


def slip(kind: str, px: float) -> float:
    """₹ per unit paid on a market fill."""
    return max(0.05, 0.005 * px) if kind in ("CE", "PE") else max(3e-4 * px, 0.025)


def _instruments() -> list[dict]:
    fresh = INSTR.exists() and time.time() - INSTR.stat().st_mtime < 12 * 3600
    if not fresh:
        tmp = INSTR.with_suffix(".tmp")
        with urllib.request.urlopen(INSTR_URL, timeout=60) as r, open(tmp, "wb") as f:
            f.write(r.read())
        tmp.replace(INSTR)
    with open(INSTR, newline="") as f:
        return [r for r in csv.DictReader(f) if r["exchange"] == "NSE" and r["segment"] == "FNO"]


def contract(symbol: str, kind: str, spot: float, today: dt.date, rows: list[dict] | None = None) -> dict:
    """The near-month FUT, or the at-the-money CE / PE of that expiry (the strike nearest the spot price)."""
    rows = [r for r in (rows if rows is not None else _instruments()) if r["underlying_symbol"] == symbol]
    futs = sorted((r for r in rows if r["instrument_type"] == "FUT" and r["expiry_date"] >= today.isoformat()), key=lambda r: r["expiry_date"])
    if not futs:
        raise ValueError(f"{symbol} has no futures contract (not an F&O stock?)")
    exp = futs[0]["expiry_date"]
    if kind == "FUT":
        c = futs[0]
    else:
        opts = [r for r in rows if r["instrument_type"] == kind and r["expiry_date"] == exp]
        if not opts:
            raise ValueError(f"no {kind} options on {symbol} for {exp}")
        c = min(opts, key=lambda r: (abs(float(r["strike_price"]) - spot), float(r["strike_price"])))
    return {"trading_symbol": c["trading_symbol"], "expiry": exp, "lot_size": int(float(c["lot_size"])), "kind": kind,
            "strike": float(c["strike_price"]) if kind != "FUT" else None}


def quotes(trading_symbols: list[str]) -> dict[str, float]:
    p = Groww().get("/v1/live-data/ltp", {"segment": "FNO", "exchange_symbols": ",".join(f"NSE_{s}" for s in trading_symbols)})
    return {k.split("_", 1)[1]: float(v) for k, v in p.items() if v is not None}


def _load() -> list[dict]:
    return json.loads(PATH.read_text()) if PATH.exists() else []


@contextlib.contextmanager
def _locked():
    PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(str(PATH) + ".lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def _save(recs: list[dict]) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(PATH.parent), prefix=".fno_paper.")
    with os.fdopen(fd, "w") as fh:
        fh.write(json.dumps(recs, indent=1))
    os.replace(tmp, PATH)


def open_paper(symbol: str, kind: str, side: str, note: str = "") -> dict:
    """Open one paper record at the live price: FUT long / short sized like Book A, or BUY 1 lot of an ATM CE / PE."""
    symbol, kind = symbol.upper().strip(), kind.upper().strip()
    side = "short" if side.lower().startswith("s") else "long"
    if kind in ("CE", "PE") and side != "long":
        raise ValueError("options are only bought here")
    if kind not in ("FUT", "CE", "PE"):
        raise ValueError("kind is FUT, CE or PE")
    today = dt.date.fromisoformat(_ist(time.time())[:10])
    spot = live.ltp([symbol])[0].get(symbol)
    if not spot:
        raise ValueError(f"no live price for {symbol}")
    c = contract(symbol, kind, spot, today)
    px = quotes([c["trading_symbol"]]).get(c["trading_symbol"])
    if not px:
        raise ValueError(f"no live price for {c['trading_symbol']}")
    sd = 1 if side == "long" else -1
    entry = round(px + sd * slip(kind, px), 2)
    lots = max(1, int(BOOK // (px * c["lot_size"]))) if kind == "FUT" else 1
    t = _ist(time.time())
    rec = {"day": t[:10], "book": "fno", "underlying": symbol, **c, "side": side, "lots": lots, "qty": lots * c["lot_size"],
           "entry": entry, "ltp_at_entry": px, "spot_at_entry": spot, "entry_time": t[11:], "status": "open", "note": note,
           "exposure_rs": round(lots * c["lot_size"] * (px if kind == "FUT" else spot), 2),
           "premium_rs": round(entry * lots * c["lot_size"], 2) if kind != "FUT" else None}
    with _locked():
        recs = _load()
        if any(r["status"] == "open" and r["trading_symbol"] == rec["trading_symbol"] for r in recs):
            raise ValueError(f"{rec['trading_symbol']} is already open")
        recs.append(rec)
        _save(recs)
    return rec


def _close(rec: dict, px: float, at: float, why: str) -> None:
    sd = 1 if rec["side"] == "long" else -1
    x = round(max(0.0, px - sd * slip(rec["kind"], px)), 2)
    buy, sell = (rec["entry"], x) if sd > 0 else (x, rec["entry"])
    gross = (x - rec["entry"]) * rec["qty"] * sd
    cost = charges(rec["kind"], buy * rec["qty"], sell * rec["qty"])
    rec.update({"status": "closed", "exit": x, "ltp_at_exit": px, "exit_time": _ist(at)[11:], "why": why,
                "gross": round(gross, 2), "costs": round(cost, 2), "net": round(gross - cost, 2)})


def close(trading_symbol: str | None = None, why: str = "admin exit") -> list[dict]:
    """Close the open record of `trading_symbol` (all open records when None) at the live price."""
    opens = [r for r in _load() if r["status"] == "open" and (trading_symbol is None or r["trading_symbol"] == trading_symbol)]
    if not opens:
        return []
    q = quotes(sorted({r["trading_symbol"] for r in opens}))
    at, done = time.time(), []
    with _locked():
        recs = _load()
        for r in recs:
            if r["status"] == "open" and r["trading_symbol"] in q and (trading_symbol is None or r["trading_symbol"] == trading_symbol):
                _close(r, q[r["trading_symbol"]], at, why)
                done.append(r)
        _save(recs)
    return done


def squareoff() -> list[dict]:
    """15:15: close every open F&O paper record (retried for a minute if a quote is missing)."""
    out = []
    for _ in range(4):
        out += close(None, "square-off 15:15")
        if not any(r["status"] == "open" for r in _load()):
            break
        time.sleep(15)
    return out


def mark() -> list[dict]:
    """Every record of today, the open ones valued at the live price (net of a closing fill and the charges)."""
    today = _ist(time.time())[:10]
    recs = [dict(r) for r in _load() if r["day"] == today]
    opens = [r for r in recs if r["status"] == "open"]
    q = quotes(sorted({r["trading_symbol"] for r in opens})) if opens else {}
    for r in opens:
        if r["trading_symbol"] in q:
            _close(r, q[r["trading_symbol"]], time.time(), "mark (still open)")
            r["status"] = "open"
    return recs
