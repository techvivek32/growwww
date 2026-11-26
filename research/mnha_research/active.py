"""Active book (paper, no orders): scans the whole market all day and rotates into what is moving, as the admin
asked on 25 Nov 2026 ("don't hold one 09:20 trade all day; if it is going wrong, exit and look for stocks going up").

One position at a time, ₹5 lakh, long or short, at most 4 trades a day. Every 2 minutes (09:35–14:45), on the 5-minute bars so far plus the live price:
  * market direction = the median stock's move since 09:20 across the F&O universe (~400 names). Longs only when it
    is +0.10% or better, shorts only when −0.10% or worse; nothing new when the market is flat.
  * candidate = the most consistent trend in that direction: ≥ 1% since 09:20, R² of the price path high, on the
    right side of VWAP most of the day, within 0.3% of the day's high (long) / low (short), ₹20 crore+ traded,
    price ≥ ₹100. Entered at the live price.
Management every 5 s on the LTP: trailing stop 0.8% from the best price since entry; and at each scan (every 2
minutes, 09:35–14:45; after 14:45 only the trailing stop and the square-off): exit when the close crosses VWAP against
the position, or when the market has moved 0.4% against the position since entry; square-off 15:15. The 5-minute bars
download in the background (BarFeed): entries and the VWAP exit use bars at most one bar behind, as the old in-loop
download did; the market-against exit needs only live prices.
Records go to data/manual_trades.json with book "active", so the paper page's card, Exit button
and live strip show them. The rule is the admin's idea. Backtested on 26 Nov 2026 in the lab (2020-07 → 2026-04, 1,437
sessions, two independent builds, verified; ~/.mnha-lab/lab/exp/active_flat_*): it LOSES after costs, about −₹285 a
trade (−₹13 lakh at ₹5 lakh a trade; −₹17–18 lakh with realistic stop fills), and trading flat markets too does not help.
Separate from Book A (the tested rule) and Book B.
"""

from __future__ import annotations

import json
import threading
import time

import numpy as np
import pandas as pd

from . import config, ingest, live, manual
from .sessions import ist_day
from .validation import day_to_date

BOOK_NAME = "active"
POLL_S = 5
TRAIL = 0.008
MKT_AGAINST = 0.004
MAX_TRADES = 4
SCAN_EVERY_S = 120  # the market is scanned every 2 minutes (the admin's instruction, 26 Nov 2026)
SCAN_FROM, SCAN_TO, SQUARE_OFF = 9 * 60 + 35, 14 * 60 + 45, 15 * 60 + 15
MIN_TURNOVER_CR, MIN_PRICE, MIN_MOVE = 20.0, 100.0, 1.0


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%d %H:%M:%S"), "active", msg, flush=True)


BEAT = config.DATA / "active_beat.json"
FRESH = config.DATA / "active_fresh.json"


def beat(day_iso: str) -> None:
    """The active book's sign of life, for the website's executor: with a position open in the accounts, a silence of
    5 minutes gets that position closed as a fail-safe."""
    try:
        tmp = BEAT.with_suffix(".tmp")
        tmp.write_text(json.dumps({"day": day_iso, "at": time.time()}))
        tmp.replace(BEAT)
    except Exception as e:  # noqa: BLE001
        log(f"heartbeat write failed: {e}")


def fresh_at(day_iso: str) -> float | None:
    """When the admin restarted the book fresh today (its trades from then on count afresh), or None."""
    try:
        f = json.loads(FRESH.read_text())
        return float(f["at"]) if f.get("day") == day_iso else None
    except Exception:  # noqa: BLE001
        return None


def start_fresh() -> dict:
    """The admin's fresh start: close the book's open paper trade at the live price, and count its trades afresh from
    now (the names already traded today stay out). The running session picks it up on its next pass."""
    day_iso = day_to_date(live.today_ist()).isoformat()
    closed = []
    for r in manual._load():
        if r.get("book") == BOOK_NAME and r["status"] == "open" and r["day"] == day_iso:
            c = manual.close_trade(r["symbol"], "admin: fresh start", r["entry_time"])
            closed.append({"symbol": c["symbol"], "net": c["net"]})
    FRESH.write_text(json.dumps({"day": day_iso, "at": time.time()}))
    log(f"fresh start: closed {closed}")
    return {"closed": closed, "fresh_at": time.time()}


def _ltps(syms: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for i in range(0, len(syms), 50):
        try:
            q, _ = live.ltp(syms[i:i + 50])
            out.update({k: float(v) for k, v in q.items() if v and v > 0})
        except Exception as e:  # noqa: BLE001  a missing chunk only leaves those names on their last bar
            log(f"ltp chunk failed: {e}")
    return out


def scan(day: int, syms: list[str], cache: dict | None = None) -> tuple[pd.DataFrame, float]:
    """Per-stock trend stats from today's 5-minute bars so far plus the live price (LTP) as the latest point, and the
    market's median move since 09:20. Bars are fetched again only when a new 5-minute bar has closed (`cache`).
    The session itself uses BarFeed + rows_from instead, so that the download never holds up the loop."""
    b = int((live.minute_ist() - (9 * 60 + 20)) // 5)  # the bar that closed most recently
    if cache is not None and cache.get("bar") == b and cache.get("got") is not None:
        got = cache["got"]
    else:
        got = live.fetch_range_day(syms + [config.BENCHMARK], day)
        if cache is not None and sum(1 for v in got.values() if v is not None) >= 0.8 * len(syms):
            cache.update(bar=b, got=got)  # a thin fetch is not kept: the next scan fetches again
    return rows_from(got, day, _ltps(syms + [config.BENCHMARK]))


class BarFeed(threading.Thread):
    """Today's 5-minute bars, kept fresh in the background: a full download takes about 2 minutes, and done inside the
    loop it held up the 2-minute scan, the 5-second trailing-stop checks and the heartbeat. A download starts when a
    new 5-minute bar has closed, only from 5 minutes before the first scan to the last one (nothing reads the bars
    outside that window). A thin or failed download is kept out; it is tried again as soon as the next bar closes, or
    sooner after a pause of 30 s, 60 s, then 2 minutes. The bars in use carry the bar their download started in, so the
    session can tell how far behind they are."""

    def __init__(self, day: int, syms: list[str], seed: "BarFeed | None" = None, clock=None):
        super().__init__(daemon=True, name="active-bars")
        self.day, self.syms = day, list(syms)
        self.stop = threading.Event()
        self._lock = threading.Lock()
        self._clock = clock if clock is not None else (lambda: time.time())  # looked up on each call
        self._got: dict | None = None
        self._bar: int | None = None  # the 5-minute bar (index from 09:20) in which the download in use started
        self._thin_bar: int | None = None
        if seed is not None:  # a replacement feed starts from the last good bars, not from nothing
            with seed._lock:
                self._got, self._bar = seed._got, seed._bar

    def snapshot(self) -> tuple[dict | None, int | None]:
        """The bars in use and the bar their download started in (None, None before the first good one), together."""
        with self._lock:
            return self._got, self._bar

    def run(self) -> None:
        backoff, tried_bar, next_try = 0.0, None, 0.0
        while not self.stop.is_set():
            m = live.minute_ist()
            if m > SCAN_TO:
                return  # no scan reads the bars after the last one
            b = int((m - (9 * 60 + 20)) // 5)  # the bar that closed most recently
            if m >= SCAN_FROM - 5 and b != self._bar and (b != tried_bar or self._clock() >= next_try):
                ok = False
                try:
                    got = live.fetch_range_day(self.syms + [config.BENCHMARK], self.day)
                    if sum(1 for v in got.values() if v is not None) >= 0.8 * len(self.syms):
                        with self._lock:
                            self._got, self._bar = got, b
                        ok = True
                    elif self._thin_bar != b:
                        self._thin_bar = b
                        log(f"bar download thin ({len(got)} of {len(self.syms)} names); trying again")
                except Exception as e:  # noqa: BLE001  the loop goes on with the last good bars
                    log(f"bar download failed: {e}")
                tried_bar = b
                backoff = 0.0 if ok else min(max(30.0, 2 * backoff), float(SCAN_EVERY_S))
                next_try = self._clock() + backoff
            self.stop.wait(5.0)


def rows_from(got: dict, day: int, q: dict[str, float]) -> tuple[pd.DataFrame, float]:
    """The scan's per-stock rows from downloaded bars `got` and live prices `q`, and the market's median move."""
    rows = []
    for s, df in got.items():
        if df is None:
            continue
        t = df["time"].to_numpy(dtype=np.int64)
        d = df[ist_day(t) == day]
        if len(d) < 4:
            continue
        c = d["close"].to_numpy(float)
        h = d["high"].to_numpy(float)
        l = d["low"].to_numpy(float)
        v = d["volume"].to_numpy(float)
        vwap = np.cumsum((h + l + c) / 3 * v) / np.maximum(np.cumsum(v), 1)
        lt = q.get(s)
        if lt:  # the live price as the latest point (no volume yet: VWAP stays at the last bar's)
            c, h, l, v, vwap = np.append(c, lt), np.append(h, lt), np.append(l, lt), np.append(v, 0.0), np.append(vwap, vwap[-1])
        x = np.arange(len(c))
        r2 = float(np.corrcoef(x, c)[0, 1] ** 2) if c.std() > 0 else 0.0
        rows.append({"symbol": s, "px": c[-1], "ret_920": (c[-1] / c[0] - 1) * 100, "r2": r2, "above_vwap": float(np.mean(c > vwap)),
                     "off_high": (c[-1] / c.max() - 1) * 100, "off_low": (c[-1] / c.min() - 1) * 100, "turnover_cr": float((c * v).sum() / 1e7),
                     "close_vs_vwap": float(c[-1] - vwap[-1])})
    if not rows:  # e.g. too few bars yet: an empty picture, which the caller's coverage check turns into "no decision"
        return pd.DataFrame(columns=["px", "ret_920", "r2", "above_vwap", "off_high", "off_low", "turnover_cr", "close_vs_vwap"], index=pd.Index([], name="symbol")), 0.0
    df = pd.DataFrame(rows).set_index("symbol")
    st = df.drop(index=config.BENCHMARK, errors="ignore")
    return df, float(st.ret_920.median()) / 100


def book_a_names(day: int) -> set[str]:
    """Book A's names today (its 09:20 pick and its flip long): the active book never trades them, because in the
    accounts the two books' orders in one symbol would net out in one intraday position."""
    try:
        from . import livex

        r = livex._db().execute("SELECT pick, flip_symbol FROM livex_days WHERE day=?", (day,)).fetchone()
        return {x for x in (r or ()) if x}
    except Exception:  # noqa: BLE001
        return set()


def pick(df: pd.DataFrame, direction: int, exclude: set[str]) -> tuple[str, float, str] | None:
    liq = df[(df.turnover_cr >= MIN_TURNOVER_CR) & (df.px >= MIN_PRICE) & (~df.index.isin(list(exclude) + [config.BENCHMARK]))]
    if direction > 0:
        c = liq[(liq.ret_920 >= MIN_MOVE) & (liq.off_high >= -0.3)].assign(score=lambda d: d.r2 + d.above_vwap)
    else:
        c = liq[(liq.ret_920 <= -MIN_MOVE) & (liq.off_low <= 0.3)].assign(score=lambda d: d.r2 + (1 - d.above_vwap))
    if c.empty:
        return None
    best = c.sort_values("score", ascending=False).iloc[0]
    why = (f"{'up' if direction > 0 else 'down'} {best.ret_920:+.2f}% since 09:20, trend R² {best.r2:.2f}, "
           f"{'above' if direction > 0 else 'below'} VWAP {100 * (best.above_vwap if direction > 0 else 1 - best.above_vwap):.0f}% of the day, "
           f"{'at the high' if direction > 0 else 'at the low'}, ₹{best.turnover_cr:.0f} Cr traded")
    return str(best.name), float(best.px), why


def session() -> dict:
    day = live.today_ist()
    from .validation import day_to_date

    date = day_to_date(day)
    if date.weekday() >= 5:
        return {"status": "weekend"}
    syms = sorted(ingest.universe())
    log(f"session {date}: active book on {len(syms)} names")
    pos: dict | None = None  # {"symbol","side","entry","qty","best","mkt_at_entry","entry_time"}
    for r in manual._load():  # resume a position left open by an earlier run today
        if r.get("book") == BOOK_NAME and r["status"] == "open" and r["day"] == date.isoformat():
            pos = {"symbol": r["symbol"], "side": -1 if r["side"] == "short" else 1, "entry": r["entry"], "qty": r["qty"], "best": r.get("best") or r["entry"],
                   "mkt_at_entry": r.get("mkt_at_entry", 0.0), "entry_time": r["entry_time"]}
    def counted() -> int:  # today's trades, or those since the admin's fresh start
        f = fresh_at(date.isoformat())
        n_ = 0
        for r in manual._load():
            if r.get("book") != BOOK_NAME or r["day"] != date.isoformat():
                continue
            hh, mm, ss = (int(x) for x in r["entry_time"].split(":"))
            at_ = live.today_ist() * 86_400 - config.IST_OFFSET_S + hh * 3600 + mm * 60 + ss
            if f is None or at_ >= f:
                n_ += 1
        return n_

    trades = counted()
    last_scan = 0.0
    feed = BarFeed(day, syms)  # the bars download in the background: the scan, the stop checks and the heartbeat never wait
    feed.start()
    # names already traded today (a restarted session must not pick them again)
    traded: set[str] = {r["symbol"] for r in manual._load() if r.get("book") == BOOK_NAME and r["day"] == date.isoformat()}
    last_poll = 0.0

    def close(why: str) -> None:
        nonlocal pos
        r = manual.close_trade(pos["symbol"], why)
        log(f"exit {pos['symbol']}: {why}, net {r['net']:+.0f}")
        pos = None

    last_beat = 0.0
    seen_fresh = fresh_at(date.isoformat())
    while True:
        now = time.time()
        minute = live.minute_ist(now)
        if minute >= 15 * 60 + 20:
            break
        if now - last_beat >= 10:
            last_beat = now
            beat(date.isoformat())
            f = fresh_at(date.isoformat())
            if f != seen_fresh:  # the admin's fresh start: count afresh
                seen_fresh = f
                trades = counted()
                log(f"fresh start seen: {trades} trades counted from now")
        try:
            if pos and now - last_poll >= POLL_S:
                last_poll = now
                if not any(r.get("book") == BOOK_NAME and r["status"] == "open" and r["symbol"] == pos["symbol"] for r in manual._load()):
                    log(f"{pos['symbol']} was closed from the page (Exit button); looking for the next trade")
                    pos = None
                    continue
                q, _ = live.ltp([pos["symbol"]])
                lt = q.get(pos["symbol"])
                if lt:
                    best = max(pos["best"], lt) if pos["side"] > 0 else min(pos["best"], lt)
                    if best != pos["best"]:  # kept in the record, so a restarted session trails from the same best price
                        pos["best"] = best
                        try:
                            manual.update_open(pos["symbol"], BOOK_NAME, {"best": best})
                        except Exception as e:  # noqa: BLE001
                            log(f"best price not saved: {e}")
                    if minute >= SQUARE_OFF:
                        close("square-off 15:15")
                    elif pos["side"] * (lt - pos["best"]) / pos["best"] <= -TRAIL:
                        close(f"trailing stop {TRAIL * 100:g}% from {pos['best']:.2f}")
            if SCAN_FROM <= minute <= SCAN_TO and now - last_scan >= SCAN_EVERY_S:
                last_scan = now
                close_min = int(minute)
                if not feed.is_alive() and minute < SCAN_TO - 1:  # never expected (its loop catches everything; it ends itself after the last scan)
                    log("the bar download had stopped; restarted")
                    feed = BarFeed(day, syms, seed=feed)
                    feed.start()
                got, bars_bar = feed.snapshot()
                if got is None or bars_bar is None:
                    log(f"scan {int(minute) // 60:02d}:{int(minute) % 60:02d}: today's bars are still downloading; no decision this time")
                    continue
                # How far behind the bars are: 0, or 1 while the current bar's download runs — what the old in-loop
                # download allowed. Further behind (downloads failing), entries and the VWAP exit wait; the market-
                # against exit needs only live prices (each name's 09:20 close is in any download) and still runs.
                behind = int((minute - (9 * 60 + 20)) // 5) - bars_bar
                df, mkt = rows_from(got, day, _ltps(syms + [config.BENCHMARK]))
                if len(df) < 0.8 * len(syms):  # too few names read: no decision on a thin market picture
                    log(f"scan {int(minute) // 60:02d}:{int(minute) % 60:02d}: only {len(df)} of {len(syms)} names read; no decision this time")
                    continue
                if pos:
                    row = df.loc[pos["symbol"]] if pos["symbol"] in df.index else None
                    if behind <= 1 and row is not None and pos["side"] * row.close_vs_vwap < 0:
                        close("close crossed VWAP against the position")
                    elif pos["side"] * (mkt - pos["mkt_at_entry"]) <= -MKT_AGAINST:
                        close(f"market moved {100 * abs(mkt - pos['mkt_at_entry']):.2f}% against since entry")
                if behind > 1:
                    if not pos:
                        log(f"scan {close_min // 60:02d}:{close_min % 60:02d}: the bars are {behind} bars behind (downloads failing); no entry this time")
                elif not pos and trades < MAX_TRADES and abs(mkt) >= 0.001:
                    direction = 1 if mkt > 0 else -1
                    cand = pick(df, direction, traded | book_a_names(day))
                    if cand:
                        sym, px, why = cand
                        rec = manual.open_trade(sym, "long" if direction > 0 else "short", note=f"market median {mkt * 100:+.2f}% since 09:20; {why}",
                                                stop_pct=TRAIL, book=BOOK_NAME, watch=False)
                        rec["mkt_at_entry"] = mkt
                        manual.update_open(sym, BOOK_NAME, {"mkt_at_entry": mkt,
                                                            "stop_rule": f"trailing {TRAIL * 100:g}% from the best price; VWAP cross against; market {MKT_AGAINST * 100:g}% against; 15:15"})
                        pos = {"symbol": sym, "side": direction, "entry": rec["entry"], "qty": rec["qty"], "best": rec["entry"], "mkt_at_entry": mkt, "entry_time": rec["entry_time"]}
                        trades += 1
                        traded.add(sym)
                        log(f"{'BUY' if direction > 0 else 'SELL'} {sym} {rec['qty']} x {rec['entry']}: {rec['note']}")
                    else:
                        log(f"scan {close_min // 60:02d}:{close_min % 60:02d}: market {mkt * 100:+.2f}%, no candidate")
                elif not pos:
                    log(f"scan {close_min // 60:02d}:{close_min % 60:02d}: market {mkt * 100:+.2f}%, {'flat, no entry' if abs(mkt) < 0.001 else 'trade limit reached'}")
            if pos and minute >= SQUARE_OFF:
                close("square-off 15:15")
        except Exception as e:  # noqa: BLE001
            log(f"error: {e}")
            time.sleep(15)
        time.sleep(1)
    feed.stop.set()
    if pos:
        try:
            close("session end")
        except Exception as e:  # noqa: BLE001
            log(f"close failed: {e}")
    log("session over")
    return {"trades": trades}
