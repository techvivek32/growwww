import os
import sys
import tempfile
from pathlib import Path

# Tests never touch the real data directory.
os.environ["MNHA_RESEARCH_DATA"] = tempfile.mkdtemp(prefix="mnha_test_")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

IST = 19_800


def epoch_ms(day: int, minute: int) -> int:
    """Bar open at IST `minute` on IST calendar day number `day`."""
    return (day * 86_400 + minute * 60 - IST) * 1000


def intraday_frame(days: list[int], interval: int, prices: np.ndarray | None = None, seed: int = 1) -> pd.DataFrame:
    """Full sessions 09:15–15:30 of `interval`-minute bars, random-walk prices."""
    times = []
    for d in days:
        m = 9 * 60 + 15
        while m < 15 * 60 + 30:
            times.append(epoch_ms(d, m))
            m += interval
    n = len(times)
    rng = np.random.default_rng(seed)
    if prices is None:
        prices = 1000 * np.exp(np.cumsum(rng.normal(0, 0.003, n)))
    o = prices * (1 + rng.normal(0, 0.0005, n))
    c = prices
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.001, n)))
    l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.001, n)))
    v = rng.integers(1_000, 50_000, n).astype(float)
    return pd.DataFrame({"time": np.array(times, dtype=np.int64), "open": o, "high": h, "low": l, "close": c, "volume": v})


def resample(df: pd.DataFrame, interval: int) -> pd.DataFrame:
    """Aggregate intraday bars into `interval`-minute (or daily) bars anchored at 09:15."""
    t = df["time"].to_numpy()
    day = (t // 1000 + IST) // 86_400
    minute = ((t // 1000 + IST) % 86_400) // 60
    if interval >= 1440:
        key = day * 10_000
        start = epoch_ms(0, 9 * 60 + 15)
        bucket_time = lambda k: (k // 10_000) * 86_400_000 + start  # noqa: E731
    else:
        b = (minute - (9 * 60 + 15)) // interval
        key = day * 10_000 + b
        bucket_time = lambda k: epoch_ms(int(k // 10_000), int(9 * 60 + 15 + (k % 10_000) * interval))  # noqa: E731
    g = df.assign(k=key).groupby("k", sort=True)
    out = pd.DataFrame({
        "open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(),
        "close": g["close"].last(), "volume": g["volume"].sum(),
    }).reset_index()
    out["time"] = [bucket_time(int(k)) for k in out["k"]]
    return out[["time", "open", "high", "low", "close", "volume"]]
