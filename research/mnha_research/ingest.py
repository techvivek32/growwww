"""Universe, history probe, and candle ingestion from Groww into Parquet.

Universe: NSE cash equities that have F&O contracts — the liquid,
intraday-shortable set — plus NIFTY and BANKNIFTY for regime features. It is
taken from Groww's current instrument list, so it carries SURVIVORSHIP BIAS
(a stock that left F&O or delisted is absent). Groww serves no history for
delisted symbols and NSE's archives are unreachable from this host; the bias
is recorded on the data version rather than hidden.

Ingestion is incremental and resumable: each (symbol, interval) keeps its
state, a failed window is retried, and a window that still fails marks the
pair as failed instead of silently storing a shorter history.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from . import config, db
from .groww import BT_MAX_DAYS, CANDLE_MAX_DAYS, DAY_MS, Groww, GrowwError

INSTRUMENT_CSV = "https://growwapi-assets.groww.in/instruments/instrument.csv"


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------ market hours
def market_busy(now: float | None = None) -> bool:
    """09:00–15:45 IST on weekdays — leave Groww's rate budget to the live terminal."""
    t = (now or time.time()) + config.IST_OFFSET_S
    wd = int((t // 86400 + 3) % 7)  # 0 = Monday
    m = int((t % 86400) // 60)
    return wd < 5 and 9 * 60 <= m <= 15 * 60 + 45


def wait_for_quiet(respect: bool) -> None:
    while respect and market_busy():
        log("market hours — pausing ingestion for 10 min")
        time.sleep(600)


# ------------------------------------------------------------ universe
def refresh_universe() -> list[str]:
    r = requests.get(INSTRUMENT_CSV, timeout=60)
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.text)))
    fno = {row["underlying_symbol"] for row in rows if row["exchange"] == "NSE" and row["instrument_type"] == "FUT"}
    eq = {
        row["trading_symbol"]: row
        for row in rows
        if row["exchange"] == "NSE" and row["segment"] == "CASH" and row["instrument_type"] == "EQ" and row["series"] == "EQ"
    }
    now = time.time()
    out = []
    recs = []
    for sym in sorted(fno):
        if "NSETEST" in sym or sym not in eq:
            continue
        row = eq[sym]
        out.append(sym)
        recs.append((sym, "NSE", row["isin"], row["name"], row["groww_symbol"], "EQ", 1, "groww-instrument-csv", now))
    # Stocks that had F&O at some point since 2003 and are still listed: daily
    # history only, for the point-in-time universe of the alpha model (pit.py).
    from . import pit

    listed = {row["trading_symbol"]: row for row in rows
              if row["exchange"] == "NSE" and row["segment"] == "CASH" and row["instrument_type"] == "EQ"}
    former = sorted(s for s in pit.members_ever() - set(out) if s in listed)
    for sym in former:
        row = listed[sym]
        recs.append((sym, "NSE", row["isin"], row["name"], row["groww_symbol"], "EQX", 0, "nse-fo-history", now))
    for sym in config.REGIME_INDICES:
        recs.append((sym, "NSE", None, sym, f"NSE-{sym}", "IDX", 0, "groww-instrument-csv", now))
    etf = next((row for row in rows if row["exchange"] == "NSE" and row["segment"] == "CASH" and row["trading_symbol"] == config.BENCHMARK), None)
    recs.append((config.BENCHMARK, "NSE", etf["isin"] if etf else None, etf["name"] if etf else config.BENCHMARK,
                 etf["groww_symbol"] if etf else f"NSE-{config.BENCHMARK}", "ETF", 0, "groww-instrument-csv", now))
    with db.tx() as con:  # a stock that left F&O is no longer part of the strategy universe
        con.execute(f"UPDATE instruments SET kind='EQX', fno=0 WHERE kind='EQ' AND symbol NOT IN ({','.join('?' * len(out))})", out)
    db.executemany(
        "INSERT INTO instruments(symbol, exchange, isin, name, groww_symbol, kind, fno, source, added_at) VALUES(?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(symbol) DO UPDATE SET isin=excluded.isin, name=excluded.name, kind=excluded.kind, fno=excluded.fno, "
        "groww_symbol=excluded.groww_symbol, source=excluded.source, added_at=excluded.added_at",
        recs,
    )
    log(f"universe: {len(out)} F&O equities + {len(former)} former F&O (daily only) + {len(config.REGIME_INDICES)} indices + {config.BENCHMARK}")
    return out


def universe(include_indices: bool = True) -> list[str]:
    """Every instrument (default), or only the current F&O equities."""
    with db.tx() as con:
        rows = con.execute("SELECT symbol, kind FROM instruments ORDER BY symbol").fetchall()
    return [r["symbol"] for r in rows if include_indices or r["kind"] == "EQ"]


def stocks(kinds: tuple[str, ...] = ("EQ", "EQX")) -> list[str]:
    with db.tx() as con:
        return [r[0] for r in con.execute(
            f"SELECT symbol FROM instruments WHERE kind IN ({','.join('?' * len(kinds))}) ORDER BY symbol", kinds)]


def daily_only() -> set[str]:
    with db.tx() as con:
        return {r[0] for r in con.execute("SELECT symbol FROM instruments WHERE kind IN ('ETF', 'EQX')")}


# ------------------------------------------------------------ probe
DAILY_FLOOR = dt.date(2003, 1, 1)  # earliest daily bar Groww serves (split/bonus-adjusted)
INTRADAY_FLOOR = dt.date(2020, 7, 1)  # earliest date the cost model covers
BT_NATIVE = (5, 15)  # downloaded from the backtesting endpoint
DERIVED = {30: 15, 60: 15}  # built from 15m bars, anchored at 09:15 like NSE


def groww_symbol(symbol: str) -> str:
    with db.tx() as con:
        r = con.execute("SELECT groww_symbol FROM instruments WHERE symbol=?", (symbol,)).fetchone()
    return (r[0] if r and r[0] else f"NSE-{symbol}")


def probe(g: Groww, symbol: str = "RELIANCE") -> dict[int, int | None]:
    """Earliest bar Groww serves per downloaded interval, by binary search on
    one-week requests. Returns {interval: earliest bar epoch ms or None}."""
    today = dt.date.today()
    out: dict[int, int | None] = {}
    gsym = groww_symbol(symbol)
    for interval in (1440,) + BT_NATIVE:
        detail: list[str] = []

        def has(day: dt.date) -> list:
            try:
                if interval == 1440:
                    at = int(dt.datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)
                    return g.candles(symbol, 1440, at, at + 7 * DAY_MS)
                return g.candles_bt(gsym, interval, day, day + dt.timedelta(days=6))
            except GrowwError as e:
                detail.append(str(e)[:120])
                return []

        lo, hi = today - dt.timedelta(days=20 * 365), today - dt.timedelta(days=10)
        if not has(hi):
            out[interval] = None
        else:
            while (hi - lo).days > 3:
                mid = lo + (hi - lo) / 2
                if has(mid):
                    hi = mid
                else:
                    lo = mid
            bars = has(hi)
            out[interval] = bars[0].time if bars else None
        with db.tx() as con:
            con.execute(
                "INSERT OR REPLACE INTO probes(interval, symbol, earliest_time, detail, probed_at) VALUES(?,?,?,?,?)",
                (interval, symbol, out[interval], json.dumps(detail[-3:]), time.time()),
            )
        e = out[interval]
        log(f"probe {interval}m: earliest {datetime.fromtimestamp(e / 1000, timezone.utc).date() if e else 'none'}")
    return out


# ------------------------------------------------------------ ingest
def _path(symbol: str, interval: int):
    p = config.CANDLES / str(interval)
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{symbol}.parquet"


def _set_state(symbol, interval, first, last, rows, status, error=None):
    with db.tx() as con:
        con.execute(
            "INSERT OR REPLACE INTO ingest_state(symbol, interval, first_time, last_time, rows, status, error, updated_at) VALUES(?,?,?,?,?,?,?,?)",
            (symbol, interval, first, last, rows, status, error, time.time()),
        )


COLS = ["time", "open", "high", "low", "close", "volume"]


def _finish(symbol: str, interval: int, old: pd.DataFrame | None, frames: list[pd.DataFrame]) -> int:
    """Merge, keep only finished regular-session bars, write atomically."""
    from .sessions import ist_day, ist_minute

    path = _path(symbol, interval)
    now = int(time.time() * 1000)
    new = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=COLS)
    df = new if old is None else pd.concat([old, new], ignore_index=True)
    if df.empty:
        _set_state(symbol, interval, None, None, 0, "empty")
        return 0
    df = df[COLS].astype({"time": "int64", "open": "float64", "high": "float64", "low": "float64", "close": "float64", "volume": "float64"})
    df = df.drop_duplicates("time", keep="last").sort_values("time").reset_index(drop=True)
    t = df["time"].to_numpy(dtype=np.int64)
    today = (now // 1000 + config.IST_OFFSET_S) // 86_400
    minute_now = ((now // 1000 + config.IST_OFFSET_S) % 86_400) // 60
    if interval < 1440:
        # The 15:30 closing-price candle is not a tradable bar of the continuous session.
        m = ist_minute(t)
        keep = (m >= config.SESSION_OPEN) & (m < config.SESSION_CLOSE) & (t + interval * 60_000 <= now)
        df = df[keep]
    elif minute_now < config.SESSION_CLOSE:
        df = df[ist_day(t) < today]  # today's daily bar is still forming
    df = df.reset_index(drop=True)
    tmp = path.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(path)
    _set_state(symbol, interval, int(df["time"].iloc[0]) if len(df) else None, int(df["time"].iloc[-1]) if len(df) else None, len(df), "ok")
    return len(df)


def _walk_daily(g: Groww, symbol: str, start: int, end: int, respect_hours: bool, before: int | None = None) -> list[pd.DataFrame]:
    """Windows from `end` back to `start`. Stops at the first empty window once
    bars were found (walked past the listing day). With `before`, only bars
    older than it count, and an empty first window means nothing older exists."""
    span = CANDLE_MAX_DAYS[1440] * DAY_MS
    frames: list[pd.DataFrame] = []
    win_to = end
    while win_to > start:
        wait_for_quiet(respect_hours)
        win_from = max(start, win_to - span)
        bars = g.candles(symbol, 1440, win_from, win_to)
        if before is not None:
            bars = [b for b in bars if b.time < before]
        if bars:
            frames.append(pd.DataFrame([b.__dict__ for b in bars]))
        elif frames or before is not None:
            break
        win_to = win_from
    return frames


def ingest_daily(g: Groww, symbol: str, respect_hours: bool = True) -> int:
    path = _path(symbol, 1440)
    now = int(time.time() * 1000)
    floor = int(dt.datetime.combine(DAILY_FLOOR, dt.time(), timezone.utc).timestamp() * 1000)
    old = pd.read_parquet(path) if path.exists() else None
    if old is None or old.empty:
        return _finish(symbol, 1440, None, _walk_daily(g, symbol, floor, now, respect_hours))
    frames = _walk_daily(g, symbol, int(old["time"].max()) - 3 * DAY_MS, now, respect_hours)
    first = int(old["time"].min())
    if first - floor > 7 * DAY_MS:  # the floor moved back, or the stock listed later (one probe)
        frames += _walk_daily(g, symbol, floor, first, respect_hours, before=first)
    return _finish(symbol, 1440, old, frames)


def ingest_bt(g: Groww, symbol: str, interval: int, respect_hours: bool = True) -> int:
    path = _path(symbol, interval)
    old = pd.read_parquet(path) if path.exists() else None
    if old is None or old.empty:
        start = INTRADAY_FLOOR
    else:
        last = int(old["time"].max())
        start = (dt.datetime.fromtimestamp(last / 1000 + config.IST_OFFSET_S, timezone.utc).date()) - dt.timedelta(days=2)
    span = BT_MAX_DAYS[interval] - 1
    gsym = groww_symbol(symbol)
    frames, end = [], dt.date.today()
    while end >= start:
        wait_for_quiet(respect_hours)
        begin = max(start, end - dt.timedelta(days=span))
        bars = g.candles_bt(gsym, interval, begin, end)
        if bars:
            frames.append(pd.DataFrame([b.__dict__ for b in bars]))
        elif old is None and frames:
            break  # before the first listed day
        end = begin - dt.timedelta(days=1)
    return _finish(symbol, interval, old, frames)


def derive(symbol: str, interval: int) -> int:
    """30m / 60m bars from 15m bars, bucketed from 09:15 (09:15–09:45, …; the
    last bucket of the day is the 15:15–15:30 remainder)."""
    from .sessions import ist_day, ist_minute

    src = _path(symbol, DERIVED[interval])
    if not src.exists():
        _set_state(symbol, interval, None, None, 0, "empty")
        return 0
    df = pd.read_parquet(src)
    t = df["time"].to_numpy(dtype=np.int64)
    day = ist_day(t)
    bucket = (ist_minute(t) - config.SESSION_OPEN) // interval
    key = day * 1000 + bucket
    g = df.assign(_k=key).groupby("_k", sort=True)
    out = pd.DataFrame({
        "time": g["time"].first(), "open": g["open"].first(), "high": g["high"].max(),
        "low": g["low"].min(), "close": g["close"].last(), "volume": g["volume"].sum(),
    }).reset_index(drop=True)
    b = (out["time"].to_numpy(dtype=np.int64) // 1000 + config.IST_OFFSET_S) // 60 % 1440
    start_min = config.SESSION_OPEN + ((b - config.SESSION_OPEN) // interval) * interval
    out["time"] = out["time"].to_numpy(dtype=np.int64) - (b - start_min) * 60_000
    path = _path(symbol, interval)
    tmp = path.with_suffix(".tmp")
    out.to_parquet(tmp, index=False)
    tmp.replace(path)
    _set_state(symbol, interval, int(out["time"].iloc[0]) if len(out) else None, int(out["time"].iloc[-1]) if len(out) else None, len(out), "derived")
    return len(out)


def ingest(symbols: list[str] | None = None, intervals=config.INTERVALS, respect_hours: bool = True) -> dict:
    g = Groww()
    if symbols is None:
        symbols = universe()
    done = failed = 0
    stopped = None
    t0 = time.time()
    order = [i for i in (1440, 15, 5) if i in intervals or (i == 15 and any(j in intervals for j in DERIVED))]
    skip_intraday = daily_only() | {config.BENCHMARK}
    for interval in order:  # daily first: it picks the liquid screening set
        for i, sym in enumerate(symbols):
            if interval != 1440 and sym in skip_intraday:
                continue  # the benchmark and former F&O names are daily-only
            try:
                rows = ingest_daily(g, sym, respect_hours) if interval == 1440 else ingest_bt(g, sym, interval, respect_hours)
                done += 1
                if i % 20 == 0:
                    log(f"{interval}m {i + 1}/{len(symbols)} {sym}: {rows} bars ({g.requests_made} requests, {time.time() - t0:.0f}s)")
            except GrowwError as e:
                failed += 1
                _set_state(sym, interval, None, None, 0, "failed", str(e)[:300])
                log(f"{interval}m {sym}: FAILED {e}")
                if e.status in (401, 403):
                    # The credentials are gone (e.g. an access token expired): every
                    # further call would fail the same way. Stop; what is stored is kept.
                    stopped = str(e)[:300]
                    break
        if stopped:
            break
    for interval in DERIVED:
        if interval in intervals:
            for sym in symbols:
                if sym not in skip_intraday:
                    derive(sym, interval)
            log(f"{interval}m derived from {DERIVED[interval]}m for {len(symbols)} symbols")
    return {"ok": done, "failed": failed, "requests": g.requests_made, "seconds": round(time.time() - t0), "stopped": stopped}


# ------------------------------------------------------------ data version
def snapshot_version(notes: str = "") -> str:
    """Hash of every candle file — runs reference this, so results are tied to
    the exact data they were computed on."""
    manifest = {}
    for p in sorted(config.CANDLES.rglob("*.parquet")):
        h = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
        manifest[str(p.relative_to(config.CANDLES))] = h
    vid = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:12]
    with db.tx() as con:
        con.execute(
            "INSERT OR IGNORE INTO data_versions(id, created_at, manifest, notes) VALUES(?,?,?,?)",
            (vid, time.time(), json.dumps(manifest), notes or "source=groww; universe=current NSE F&O equities (survivorship-biased)"),
        )
    return vid


def latest_version() -> str | None:
    with db.tx() as con:
        r = con.execute("SELECT id FROM data_versions ORDER BY created_at DESC LIMIT 1").fetchone()
    return r[0] if r else None


def day_bounds(interval: int, symbols: list[str]) -> np.ndarray:
    """All IST trading days present for an interval, across symbols."""
    from .sessions import ist_day

    days: set[int] = set()
    for s in symbols:
        p = config.CANDLES / str(interval) / f"{s}.parquet"
        if p.exists():
            t = pd.read_parquet(p, columns=["time"])["time"].to_numpy(dtype=np.int64)
            days.update(np.unique(ist_day(t)).tolist())
    return np.array(sorted(days), dtype=np.int64)
