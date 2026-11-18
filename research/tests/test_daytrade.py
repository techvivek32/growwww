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


def _head(d, n):
    p = d["p"]
    q = alpha.Panel(p.days[:n], p.symbols, p.O[:n], p.H[:n], p.L[:n], p.C[:n], p.V[:n], p.bench_o[:n], p.bench_c[:n])
    return {**d, "p": q, "member": d["member"][:n], "deliv": d["deliv"][:n], "oi": {k: v[:n] for k, v in d["oi"].items()}}


def test_stage1_final_matches_a_fresh_walk_forward_as_the_panel_grows(monkeypatch, tmp_path):
    from mnha_research import config, nse

    monkeypatch.setattr(config, "DATA", tmp_path)
    monkeypatch.setattr(nse, "building", lambda: False)
    monkeypatch.setattr(daytrade, "MIN_TRAIN_YEARS", 1)
    monkeypatch.setattr(daytrade, "HGB", {**daytrade.HGB, "max_iter": 20, "min_samples_leaf": 200})
    calls = []
    real = daytrade.walk_forward
    monkeypatch.setattr(daytrade, "walk_forward", lambda des, **kw: calls.append(kw.get("only_years")) or real(des, **kw))
    full = panel(D=900)  # 2011-01-26 .. 2013-07: folds 2012 and 2013

    des = daytrade.design(_head(full, 880))
    np.testing.assert_array_equal(daytrade.stage1_final(des), real(des, final=True)["pred"])
    assert calls == [None]  # nothing stored: recomputed whole

    des = daytrade.design(_head(full, 890))  # ten more sessions of 2013
    calls.clear()
    np.testing.assert_array_equal(daytrade.stage1_final(des), real(des, final=True)["pred"])
    assert calls == [{2013}]  # 2012's fold kept, 2013 refitted

    d = _head(full, 890)
    d["deliv"] = d["deliv"].copy()
    d["deliv"][300] *= 0.5  # a revised day of 2011 changes what every kept fold read
    des = daytrade.design(d)
    calls.clear()
    np.testing.assert_array_equal(daytrade.stage1_final(des), real(des, final=True)["pred"])
    assert calls == [None]

    stored = np.load(tmp_path / "daytrade_pred_final.npy")
    d = _head(full, 890)
    d["member"] = np.zeros_like(d["member"])  # no membership file: nothing is eligible
    try:
        daytrade.stage1_final(daytrade.design(d))
        raise AssertionError("an empty score must not be stored")
    except RuntimeError:
        pass
    np.testing.assert_array_equal(np.load(tmp_path / "daytrade_pred_final.npy"), stored)
