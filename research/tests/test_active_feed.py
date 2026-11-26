"""The active book's background bar download (BarFeed) and the scan rows built from it (rows_from)."""
import threading
import time

import numpy as np
import pandas as pd

from conftest import epoch_ms
from mnha_research import active, config, live

DAY = 20_000


def bars(seed: int, n: int = 30, drift: float = 0.0) -> pd.DataFrame:
    """n 5-minute bars of DAY from 09:15, a random walk with a drift."""
    rng = np.random.default_rng(seed)
    c = 1000 * np.cumprod(1 + drift + rng.normal(0, 0.002, n))
    o = np.r_[c[0], c[:-1]]
    return pd.DataFrame({
        "time": [epoch_ms(DAY, 9 * 60 + 15 + 5 * i) for i in range(n)],
        "open": o, "high": np.maximum(o, c) * 1.001, "low": np.minimum(o, c) * 0.999, "close": c,
        "volume": rng.integers(1_000, 50_000, n).astype(float),
    })


def universe(k: int = 40) -> dict[str, pd.DataFrame]:
    got = {f"S{i}": bars(i, drift=(i - k / 2) * 1e-4) for i in range(k)}
    got[config.BENCHMARK] = bars(999)
    return got


def test_rows_from_matches_the_old_scan(monkeypatch):
    got = universe()
    syms = [s for s in got if s != config.BENCHMARK]
    q = {s: float(df.close.iloc[-1]) * 1.002 for s, df in got.items()}
    monkeypatch.setattr(live, "fetch_range_day", lambda symbols, day: {s: got[s] for s in symbols})
    monkeypatch.setattr(live, "minute_ist", lambda *a: 11 * 60)
    monkeypatch.setattr(active, "_ltps", lambda symbols: {s: q[s] for s in symbols})
    a, ma = active.scan(DAY, syms, {})
    b, mb = active.rows_from(got, DAY, q)
    pd.testing.assert_frame_equal(a, b)
    assert ma == mb


def test_rows_from_with_too_few_bars_is_an_empty_picture():
    got = {s: df.head(3) for s, df in universe().items()}  # three bars: below the four a row needs
    df, mkt = active.rows_from(got, DAY, {})
    assert df.empty and mkt == 0.0
    assert len(df) < 0.8 * 40  # the session's coverage check then makes no decision
    assert active.pick(df, 1, set()) is None


class Harness:
    """A BarFeed on a fake clock: each 5-second wait moves the clock 5 s; the minute follows the clock."""

    def __init__(self, monkeypatch, fetch, start_minute: float):
        self.t = 0.0
        self.m0 = start_minute
        self.lock = threading.Lock()
        monkeypatch.setattr(live, "fetch_range_day", fetch)
        monkeypatch.setattr(live, "minute_ist", lambda *a: self.minute())
        self.got = universe()
        self.syms = [s for s in self.got if s != config.BENCHMARK]
        self.feed = active.BarFeed(DAY, self.syms, clock=lambda: self.t)
        self.feed.stop.wait = self.wait

    def minute(self) -> float:
        return self.m0 + self.t / 60

    def wait(self, s: float) -> bool:
        with self.lock:
            self.t += s
        time.sleep(0.002)
        return self.feed.stop.is_set()

    def run_until(self, cond, limit_s: float = 5.0) -> None:
        deadline = time.time() + limit_s
        while not cond() and time.time() < deadline and self.feed.is_alive():
            time.sleep(0.005)


def test_barfeed_keeps_only_good_downloads_and_retries_with_a_growing_pause(monkeypatch):
    mode = {"v": "thin"}
    calls: list[float] = []
    box: dict = {}

    gate = threading.Event()

    def fetch(symbols, day):
        h = box["h"]
        calls.append(h.t)
        if mode["v"] == "thin":
            return {s: h.got[s] for s in symbols[:5]}
        if mode["v"] == "boom":
            raise RuntimeError("HTTP 429")
        if mode["v"] == "slow":
            gate.wait(5)  # a download still running
        return {s: h.got[s] for s in symbols}

    h = box["h"] = Harness(monkeypatch, fetch, start_minute=10 * 60 + 0.5)  # 10:00:30, inside bar 8
    t0 = time.time()
    h.feed.start()
    try:
        assert h.feed.snapshot() == (None, None) and time.time() - t0 < 0.2  # never waits on the download
        h.run_until(lambda: len(calls) >= 4)
        # thin downloads are kept out and retried 30 s, then 60 s, then 2 minutes later (or at the next bar)
        assert h.feed.snapshot() == (None, None)
        gaps = [b - a for a, b in zip(calls, calls[1:])]
        assert gaps[0] == 30 and gaps[1] == 60
        assert all(g <= active.SCAN_EVERY_S for g in gaps)
        mode["v"] = "boom"
        n = len(calls)
        h.run_until(lambda: len(calls) >= n + 2)
        assert h.feed.snapshot() == (None, None) and h.feed.is_alive()  # a failing download does not end the feed
        mode["v"] = "full"
        h.run_until(lambda: h.feed.snapshot()[0] is not None)
        got, bar = h.feed.snapshot()
        assert got is not None and len(got) == len(h.got)
        assert bar == int((h.minute() - (9 * 60 + 20)) // 5)  # the bar the download started in
        n = len(calls)
        mode["v"] = "slow"
        boundary = 9 * 60 + 20 + 5 * (bar + 1)  # the minute the next bar closes
        h.run_until(lambda: h.minute() >= boundary - 6 / 60)
        assert len(calls) == n  # the same bar: no new download
        h.run_until(lambda: len(calls) > n, limit_s=5)
        assert int((calls[n] / 60 + h.m0 - (9 * 60 + 20)) // 5) == bar + 1  # the next one when the next bar closes
        assert h.feed.snapshot() == (got, bar)  # the last good bars stay in use while the next download runs
        repl = active.BarFeed(DAY, h.syms, seed=h.feed)
        assert repl.snapshot() == (got, bar)  # a replacement feed starts from the last good bars
        gate.set()
        h.run_until(lambda: h.feed.snapshot()[1] == bar + 1)
        assert h.feed.snapshot()[1] == bar + 1 and h.feed.snapshot()[0] is not got
    finally:
        h.feed.stop.set()
        h.feed.join(timeout=3)
    assert not h.feed.is_alive()


def test_barfeed_retries_at_once_when_a_new_bar_closes(monkeypatch):
    calls: list[float] = []
    box: dict = {}

    def fetch(symbols, day):
        calls.append(box["h"].minute())
        return {}  # every download fails (thin)

    h = box["h"] = Harness(monkeypatch, fetch, start_minute=10 * 60 + 4.5)  # 10:04:30: the bar closes in 30 s
    h.feed.start()
    try:
        h.run_until(lambda: len(calls) >= 2)
        assert calls[0] == 10 * 60 + 4.5
        assert abs(calls[1] - (10 * 60 + 5)) < 0.1  # 10:05: a new bar closed, tried again without waiting out the pause
    finally:
        h.feed.stop.set()
        h.feed.join(timeout=3)


def test_barfeed_downloads_only_around_the_scan_window(monkeypatch):
    calls: list[float] = []
    box: dict = {}

    def fetch(symbols, day):
        calls.append(box["h"].minute())
        return {s: box["h"].got[s] for s in symbols}

    h = box["h"] = Harness(monkeypatch, fetch, start_minute=9 * 60 + 10)
    h.feed.start()
    try:
        h.run_until(lambda: len(calls) >= 1)
        assert calls[0] >= 9 * 60 + 30  # nothing before 09:30 (no scan before 09:35)
        h.t = (active.SCAN_TO + 0.5 - h.m0) * 60  # after the last scan
        h.feed.join(timeout=3)
        assert not h.feed.is_alive()  # it ends without another download
        assert all(c <= active.SCAN_TO for c in calls)
    finally:
        h.feed.stop.set()
