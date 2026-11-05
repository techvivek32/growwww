import numpy as np
import pandas as pd

from mnha_research import quality

from conftest import epoch_ms, intraday_frame

DAYS = list(range(20_000, 20_040))


def daily_from(df: pd.DataFrame) -> pd.DataFrame:
    day = (df["time"] // 1000 + 19_800) // 86_400
    g = df.groupby(day)
    return pd.DataFrame({"time": [epoch_ms(int(d), 555) for d in g.groups], "open": g["open"].first().to_numpy(),
                         "high": g["high"].max().to_numpy(), "low": g["low"].min().to_numpy(),
                         "close": g["close"].last().to_numpy(), "volume": g["volume"].sum().to_numpy()})


def test_unadjusted_split_is_a_break_and_bad_ticks_are_clipped():
    raw = intraday_frame(DAYS, 15, seed=5)
    day = (raw["time"] // 1000 + 19_800) // 86_400
    split = DAYS[20]
    before = (day < split).to_numpy()
    raw.loc[before, ["open", "high", "low", "close"]] *= 2.0  # 2:1 split, intraday left unadjusted
    daily = daily_from(raw)
    daily.loc[daily.index[:20], ["open", "high", "low", "close"]] /= 2.0  # daily adjusted
    bad = int(np.nonzero((day == DAYS[30]).to_numpy())[0][5])
    true_high = raw.loc[bad, "high"]
    raw.loc[bad, "high"] = true_high * 100  # a fat-finger tick
    fixed, steps, stats = quality.reconcile(raw, daily)
    assert steps == [split]
    assert stats["clipped"] == 1 and fixed.loc[bad, "high"] <= true_high * 1.04
    other = np.ones(len(raw), dtype=bool)
    other[bad] = False
    assert (fixed["high"].to_numpy()[other] == raw["high"].to_numpy()[other]).all()


def test_consistent_series_need_nothing():
    raw = intraday_frame(DAYS, 15, seed=6)
    fixed, steps, stats = quality.reconcile(raw, daily_from(raw))
    assert steps == [] and stats["clipped"] == 0 and stats["disagree"] == 0


def test_series_that_keep_disagreeing_are_counted():
    raw = intraday_frame(DAYS, 15, seed=7)
    daily = daily_from(raw)
    drift = np.exp(np.arange(len(daily)) * 0.06)  # a different price path, not a split
    for k in ("open", "high", "low", "close"):
        daily[k] = daily[k] * drift
    st = quality.reconcile(raw, daily)[2]
    assert st["steps"] > quality.MAX_STEPS or st["disagree"] > quality.MAX_DISAGREE


def test_open_and_close_prints_outside_the_day_range_are_carried_forward():
    raw = intraday_frame(DAYS, 15, seed=8)
    daily = daily_from(raw)  # the official range, from the true bars
    day = ((raw["time"] // 1000 + 19_800) // 86_400).to_numpy()
    rows = np.nonzero(day == DAYS[12])[0]
    i = int(rows[6])
    prev_close = raw.loc[i - 1, "close"]
    raw.loc[i, ["close", "high"]] = raw.loc[i, "close"] * 100  # the 2025-05-12 kind of glitch
    raw.loc[i + 1, ["open", "high"]] = raw.loc[i + 1, "open"] * 100
    fixed, steps, stats = quality.reconcile(raw, daily)
    assert stats["fixed_oc"] == 2 and steps == []
    assert fixed.loc[i, "close"] == prev_close and fixed.loc[i + 1, "open"] == prev_close
    assert fixed.loc[i, "high"] < prev_close * 1.2 and fixed.loc[i + 1, "high"] < prev_close * 1.2
    assert (fixed["high"] >= fixed[["open", "close"]].max(axis=1)).all()
    assert (fixed["low"] <= fixed[["open", "close"]].min(axis=1)).all()
    first = int(rows[0])
    raw2 = intraday_frame(DAYS, 15, seed=8)
    raw2.loc[first, ["open", "high"]] = raw2.loc[first, "open"] * 50  # the day's first print
    fixed2 = quality.reconcile(raw2, daily)[0]
    assert fixed2.loc[first, "open"] == raw2.loc[first, "close"] or fixed2.loc[first, "open"] < raw2.loc[first, "close"] * 1.2


def test_a_whole_day_outside_the_daily_range_is_left_alone():
    raw = intraday_frame(DAYS, 15, seed=9)
    daily = daily_from(raw)
    day = ((raw["time"] // 1000 + 19_800) // 86_400).to_numpy()
    m = day == DAYS[7]
    raw.loc[m, ["open", "high", "low", "close"]] *= 1.5  # the two series disagree about this day
    fixed, steps, stats = quality.reconcile(raw, daily)
    assert stats["fixed_oc"] == 0
    assert (fixed.loc[m, "close"].to_numpy() == raw.loc[m, "close"].to_numpy()).all()
