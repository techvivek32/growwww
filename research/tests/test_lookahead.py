"""No strategy may use the future. Perturb every bar from index K on; every
signal and every trade that closed before K must be bit-for-bit unchanged."""

import numpy as np
import pandas as pd

from mnha_research import dna, engine, rules
from mnha_research.series import Cache, Series

from conftest import intraday_frame, resample

DAYS = list(range(20_000, 20_000 + 60))


def perturbed(df: pd.DataFrame, k: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    out = df.copy()
    n = len(df) - k
    f = np.exp(rng.normal(0, 0.02, n))
    for col in ("open", "high", "low", "close"):
        out.loc[k:, col] = df.loc[k:, col].to_numpy() * f
    out.loc[k:, "volume"] = df.loc[k:, "volume"].to_numpy() * rng.uniform(0.2, 5, n)
    return out


def setup(df5: pd.DataFrame, tf: int):
    base = df5 if tf == 5 else resample(df5, tf)
    htf = {i: Series("X", i, resample(df5, i)) for i in (60, 1440) if i > tf}
    s = Series("X", tf, base)
    return s, Cache(s, lambda i: htf.get(i))


def test_signals_and_trades_never_see_the_future():
    df = intraday_frame(DAYS, 5, seed=42)
    cut_day = DAYS[40]
    k5 = int(np.argmax(((df["time"].to_numpy() // 1000 + 19_800) // 86_400) >= cut_day))
    df2 = perturbed(df, k5, seed=9)
    strategies = [d for _, _, d in dna.generate(1600, seed=99) if d["tf"] in (5, 15, 30, 60)]
    checked = 0
    for tf in (5, 15, 60):
        s1, c1 = setup(df, tf)
        s2, c2 = setup(df2, tf)
        k = int(np.argmax(s1.sess.day >= cut_day))
        assert (s1.t == s2.t).all() and not np.allclose(s1.c[k:], s2.c[k:])
        atr1, atr2 = c1.atr(14), c2.atr(14)
        np.testing.assert_array_equal(atr1[:k], atr2[:k])
        for d in [x for x in strategies if x["tf"] == tf][:120]:
            a = rules.build(d, c1)
            b = rules.build(d, c2)
            for x, y in zip(a, b):
                # a signal at bar k-1 may only be acted on at bar k, so compare < k
                np.testing.assert_array_equal(x[:k], y[:k], err_msg=f"{d}")
            t1 = engine.run(s1, d, a, atr1)
            t2 = engine.run(s2, d, b, atr2)
            done1 = t1.x_i < k
            done2 = t2.x_i < k
            np.testing.assert_array_equal(t1.e_i[done1], t2.e_i[done2])
            np.testing.assert_allclose(t1.net[done1], t2.net[done2])
            checked += 1
    assert checked > 100


def with_delivery(s: Series, days, seed: int, cut_day: int | None = None):
    rng = np.random.default_rng(seed)
    share = rng.uniform(0.2, 0.8, len(days))
    if cut_day is not None:
        share = share.copy()
        later = np.asarray(days) >= cut_day
        share[later] = rng.uniform(0.2, 0.8, int(later.sum()))
    s.deliv = (np.asarray(days, dtype=np.int64), share)
    return s


def test_short_program_never_sees_the_future():
    """Same perturbation test for the v2 rules, daily-ATR carries and NSE
    delivery data — the delivery series is changed from the cut day on too."""
    df = intraday_frame(DAYS, 5, seed=43)
    cut_day = DAYS[40]
    k5 = int(np.argmax(((df["time"].to_numpy() // 1000 + 19_800) // 86_400) >= cut_day))
    df2 = perturbed(df, k5, seed=10)
    strategies = [d for _, _, d in dna.generate(2700, seed=98, version=dna.SHORT_VERSION)]
    checked = 0
    for tf in (5, 15, 60, 1440):
        s1, c1 = setup(df, tf)
        s2, c2 = setup(df2, tf)
        with_delivery(s1, DAYS, 1)
        with_delivery(s2, DAYS, 1, cut_day)
        k = int(np.argmax(s1.sess.day >= cut_day))
        for d in [x for x in strategies if x["tf"] == tf][:150]:
            a = rules.build(d, c1)
            b = rules.build(d, c2)
            for x, y in zip(a, b):
                np.testing.assert_array_equal(x[:k], y[:k], err_msg=f"{d}")
            t1 = engine.run(s1, d, a, engine.stop_atr(d, c1))
            t2 = engine.run(s2, d, b, engine.stop_atr(d, c2))
            done1 = t1.x_i < k
            done2 = t2.x_i < k
            np.testing.assert_array_equal(t1.e_i[done1], t2.e_i[done2])
            np.testing.assert_allclose(t1.net[done1], t2.net[done2])
            checked += 1
    assert checked > 300


def test_intraday_bars_see_only_the_previous_sessions_delivery():
    df = intraday_frame(DAYS[:30], 15, seed=3)
    s = Series("X", 15, df)
    share = np.linspace(0.1, 0.9, 30)
    s.deliv = (np.asarray(DAYS[:30], dtype=np.int64), share)
    got, _ = Cache(s).delivery()
    for i, d in enumerate(DAYS[:30]):
        bars = got[s.sess.day == d]
        if i == 0:
            assert np.isnan(bars).all()
        else:
            assert np.allclose(bars, share[i - 1])
    sd = Series("X", 1440, resample(df, 1440))
    sd.deliv = s.deliv
    got_d, _ = Cache(sd).delivery()
    assert np.allclose(got_d, share)  # a daily bar's signal fills next open, after publication


def test_entries_only_while_a_member():
    df = intraday_frame(DAYS[:30], 15, seed=4)
    s = Series("X", 15, df)
    d = dna.normalise({"v": dna.SHORT_VERSION, "family": "short_term", "tf": 15, "side": "both", "entry": {"rule": "ibs", "t": 0.3},
                       "filters": [], "exit": {"stop": 1.0, "target": 0.0, "trail": 0.0, "opp": False, "hold": 0}})
    full = rules.build(d, Cache(s))
    assert full[0].any() or full[1].any()
    s.member = s.sess.day >= DAYS[15]
    gated = rules.build(d, Cache(s))
    for x in gated[:2]:
        assert not x[s.sess.day < DAYS[15]].any()
