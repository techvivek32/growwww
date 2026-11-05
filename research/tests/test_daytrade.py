"""The intraday model may use the open of the day it trades and nothing later."""

import numpy as np

from mnha_research import alpha, daytrade


def panel(D=420, S=40, seed=0):
    rng = np.random.default_rng(seed)
    days = np.arange(15_000, 15_000 + D)  # starts 2011-01, past FIRST_ROW_DAY
    C = 100 * np.exp(np.cumsum(rng.normal(0, 0.015, (D, S)), axis=0))
    O = C * np.exp(rng.normal(0, 0.006, (D, S)))
    O[1:] = C[:-1] * np.exp(rng.normal(0, 0.01, (D - 1, S)))
    H = np.maximum(O, C) * (1 + np.abs(rng.normal(0, 0.005, (D, S))))
    L = np.minimum(O, C) * (1 - np.abs(rng.normal(0, 0.005, (D, S))))
    V = rng.uniform(1e5, 1e6, (D, S))
    p = alpha.Panel(days, [f"S{j}" for j in range(S)], O, H, L, C, V, O[:, 0].copy(), C[:, 0].copy())
    oi = {k: rng.uniform(1e6, 2e6, (D, S)) for k in ("fut_oi", "ce_oi", "pe_oi")}
    return {"p": p, "member": np.ones((D, S), dtype=bool), "deliv": rng.uniform(0.2, 0.8, (D, S)), "oi": oi,
            "data_version": None, "hist0": np.full(S, 300)}


def test_features_see_only_the_open_of_the_day():
    d1 = panel()
    t = 350
    d2 = panel()
    p2 = d2["p"]
    rng = np.random.default_rng(5)
    for a in (p2.H, p2.L, p2.C, p2.V, d2["deliv"], d2["oi"]["fut_oi"], d2["oi"]["ce_oi"], d2["oi"]["pe_oi"]):
        a[t:] *= rng.uniform(0.8, 1.25, a[t:].shape)
    p2.O[t + 1:] *= rng.uniform(0.8, 1.25, p2.O[t + 1:].shape)
    p2.bench_c[t:] *= 1.1
    p2.bench_o[t + 1:] *= 1.1
    a, b = daytrade.design(d1), daytrade.design(d2)
    np.testing.assert_array_equal(a["elig"][: t + 1], b["elig"][: t + 1])
    assert a["elig"][t].sum() >= daytrade.MIN_NAMES
    for k in a["x"]:
        np.testing.assert_array_equal(a["x"][k][: t + 1], b["x"][k][: t + 1], err_msg=k)
    for k in a["m"]:
        np.testing.assert_array_equal(a["m"][k][: t + 1], b["m"][k][: t + 1], err_msg=k)
    assert not np.allclose(np.nan_to_num(a["y"][t]), np.nan_to_num(b["y"][t]))  # the label is the day itself


def test_trades_long_top_short_bottom_with_intraday_costs():
    des = daytrade.design(panel())
    t = 400
    pred = np.full(des["y"].shape, np.nan, dtype=np.float32)
    pred[t] = np.arange(des["y"].shape[1], dtype=np.float32)
    T = daytrade.trades(des, pred, {"long": 2, "short": 2, "hurdle": 0.0}, np.array([t]))
    ok = np.nonzero(des["elig"][t] & des["tradable"][t])[0]
    assert sorted(T[T.side > 0].symbol) == sorted(f"S{j}" for j in ok[-2:])
    assert sorted(T[T.side < 0].symbol) == sorted(f"S{j}" for j in ok[:2])
    p = des["d"]["p"]
    r = T.iloc[0]
    j = int(r.symbol[1:])
    assert r.entry == p.O[t, j] * (1 + daytrade.ENTRY_SLIP_BPS / 1e4 * r.side)
    assert (T.costs > 0).all() and (T.costs < 0.002 * T.qty * T.entry).all()  # intraday, not delivery
