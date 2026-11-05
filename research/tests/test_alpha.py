import json
import time

import joblib
import numpy as np
import pandas as pd
import pytest

from mnha_research import alpha, config, db, paper
from mnha_research.costs import trade_costs

IST = 19_800


def weekdays(start_day: int, n: int) -> np.ndarray:
    out, d = [], start_day
    while len(out) < n:
        if (d + 3) % 7 < 5:
            out.append(d)
        d += 1
    return np.array(out, dtype=np.int64)


def daily_frame(days, seed, drift=0.0):
    rng = np.random.default_rng(seed)
    n = len(days)
    c = 100 * np.exp(np.cumsum(rng.normal(drift, 0.015, n)))
    o = c * (1 + rng.normal(0, 0.003, n))
    h = np.maximum(o, c) * (1 + np.abs(rng.normal(0, 0.004, n)))
    l = np.minimum(o, c) * (1 - np.abs(rng.normal(0, 0.004, n)))
    v = rng.integers(10_000, 200_000, n).astype(float)
    t = (days * 86_400 + 555 * 60 - IST) * 1000
    return pd.DataFrame({"time": t.astype(np.int64), "open": o, "high": h, "low": l, "close": c, "volume": v})


DAY0 = (np.datetime64("2010-01-04") - np.datetime64("1970-01-01")).astype(int)


def synthetic_panel(n_sym=40, n_days=1500):
    days = weekdays(DAY0, n_days)
    frames = {f"S{i:02d}": daily_frame(days, i) for i in range(n_sym)}
    return alpha.panel_from_frames(frames, daily_frame(days, 999))


@pytest.fixture(scope="module")
def small(monkeypatch_module):
    monkeypatch_module.setattr(alpha, "MIN_TRAIN_YEARS", 2)
    monkeypatch_module.setattr(alpha, "MIN_NAMES", 10)
    return synthetic_panel()


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def test_features_do_not_look_ahead(small):
    a = alpha.design(small)
    k = 900
    p2 = alpha.Panel(small.days, small.symbols, *(x.copy() for x in (small.O, small.H, small.L, small.C, small.V)),
                     small.bench_o.copy(), small.bench_c.copy())
    rng = np.random.default_rng(3)
    scale = np.exp(rng.normal(0, 0.2, (len(small.days) - k - 1, len(small.symbols))))
    for arr in (p2.O, p2.H, p2.L, p2.C):
        arr[k + 1:] *= scale
    p2.V[k + 1:] *= 3
    p2.bench_c[k + 1:] *= 1.3
    b = alpha.design(p2)
    for name in alpha.STOCK_FEATURES:
        np.testing.assert_array_equal(a.ranked[name][: k + 1], b.ranked[name][: k + 1], err_msg=name)
    for name in alpha.MARKET_FEATURES:
        np.testing.assert_array_equal(a.market[name][: k + 1], b.market[name][: k + 1], err_msg=name)
    np.testing.assert_array_equal(a.elig[: k + 1], b.elig[: k + 1])


def test_decisions_are_week_ends_and_execute_next_session(small):
    d = alpha.design(small)
    wd = (small.days[d.R] + 3) % 7
    assert (wd == 4).all()  # synthetic calendar has every Friday
    assert ((small.days[d.E] + 3) % 7 == 0).all()  # next Monday


def test_labels_are_open_to_open(small):
    d = alpha.design(small)
    raw, pct, known = alpha.labels(d, 4)
    i = len(d.R) // 2
    j = int(np.nonzero(d.elig[d.R[i]])[0][0])
    assert raw[i, j] == pytest.approx(small.C[d.E[i + 4], j] / small.C[d.E[i], j] - 1)
    assert known[i] == d.E[i + 4]
    assert np.isnan(raw[-1]).all()  # no future to label


def test_walk_forward_embargo(small):
    d = alpha.design(small)
    for h in (1, 4):
        _raw, _pct, known = alpha.labels(d, h)
        plan = alpha.fold_plan(d, h, known)
        assert plan
        for _Y, train, test in plan:
            assert known[train].max() <= d.R[test[0]]  # every training label was known at the first test decision
            assert d.R[train].max() < d.R[test[0]]


def tiny_panel():
    days = weekdays(DAY0, 12)
    S = 3
    O = np.full((12, S), 100.0)
    C = np.full((12, S), 100.0)
    return alpha.Panel(days, ["A", "B", "C"], O, O.copy(), O.copy(), C, np.full((12, S), 1e5), np.full(12, 100.0), np.full(12, 100.0))


def tiny_design(p):
    return alpha.Design(p, {}, {}, np.zeros_like(p.C), np.ones_like(p.C, dtype=bool), p.C.copy(), np.array([0]), np.array([1]), p.C)


def test_simulate_rotates_and_charges_costs():
    p = tiny_panel()
    d = tiny_design(p)
    ev = [(1, np.array([3.0, 2.0, 1.0])), (6, np.array([1.0, 3.0, 2.0]))]
    sim = alpha.simulate(d, ev, k=1, buffer=2, slippage_bps=0.0, book=100_000.0)
    assert [t["symbol"] for t in sim["trades"]] == ["A", "B"]
    assert sim["trades"][0]["exit_day"] == int(p.days[6])
    c = trade_costs(np.array([100_000.0]), np.array([100_000.0]), np.array([1]), np.array([int(p.days[1])]), False)[0]
    assert sim["trades"][0]["cost"] == pytest.approx(c)
    assert sim["trades"][1]["qty"] == int((100_000.0 - c) // 100)  # the first round trip's costs came out of the cash
    assert sim["equity"][-1] == pytest.approx(100_000.0 - sum(t["cost"] for t in sim["trades"]))


def test_simulate_keeps_a_holding_inside_the_buffer():
    p = tiny_panel()
    d = tiny_design(p)
    ev = [(1, np.array([3.0, 2.0, 1.0])), (6, np.array([2.0, 3.0, 1.0]))]  # A drops to rank 2 of 3: inside buffer 2
    sim = alpha.simulate(d, ev, k=1, buffer=2, slippage_bps=0.0)
    assert [t["why"] for t in sim["trades"]] == ["end"]


def test_simulate_does_not_buy_without_a_price():
    p = tiny_panel()
    p.C[1, 0] = np.nan
    d = tiny_design(p)
    sim = alpha.simulate(d, [(1, np.array([3.0, 2.0, 1.0]))], k=1, buffer=1, slippage_bps=0.0)
    assert sim["trades"][0]["symbol"] == "B"


def test_end_to_end_walk_forward_and_paper(small, monkeypatch):
    d = alpha.design(small)
    wf = alpha.walk_forward(d, 1)
    assert wf["folds"]
    res = alpha.evaluate(d, wf, 1)
    for k in ("model", "equal_weight_universe", "niftybees", "momentum_12_1", "information", "excess_vs_equal_weight_universe"):
        assert k in res
    assert np.isfinite(res["model"]["cagr"])

    # paper: freeze a model, publish on the Friday evening, execute at Monday's close
    db.migrate()
    model, _ = alpha.fit_final(d, 1)
    art = config.MODELS / "alpha_weekly_test.joblib"
    config.MODELS.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model}, art)
    with db.tx() as con:
        con.execute("INSERT INTO ml_models(run_id, created_at, kind, features, params, metrics, artifact) VALUES(0,0,'alpha_weekly','[]','{}','{}',?)", (str(art),))
        con.execute("INSERT INTO ml_models(run_id, created_at, kind, features, params, metrics, artifact) VALUES(0,0,'alpha_monthly','[]','{}','{}',?)", (str(art),))
    books = paper.start()
    assert all(b["new"] for b in books)
    fri = [r for r in range(len(small.days)) if (small.days[r] + 3) % 7 == 4][-3]
    cut = alpha.Panel(small.days[: fri + 1], small.symbols, *(x[: fri + 1] for x in (small.O, small.H, small.L, small.C, small.V)),
                      small.bench_o[: fri + 1], small.bench_c[: fri + 1])
    dc = alpha.design(cut)
    friday_evening = (int(small.days[fri]) * 86_400 + 16 * 3600 - IST)
    out = paper.publish(now=friday_evening, des=dc)
    assert sum(o["published"] for o in out) == 2
    again = paper.publish(now=friday_evening + 60, des=dc)
    assert not any(o["published"] for o in again)
    marks = paper.mark(d)
    assert marks[0]["started"] == str(np.datetime64(int(small.days[fri + 1]), "D"))  # the Monday after
    assert marks[0]["equity"] > 0


def test_adjust_actions_removes_the_stitch_and_known_demergers():
    days = weekdays(alpha.STITCH_DAY - 20, 40)
    c = np.full(40, 100.0)
    st = int(np.searchsorted(days, alpha.STITCH_DAY))
    c[:st] = 200.0  # pre-2010 history on a 2x scale
    o, h, l, v = c.copy(), c.copy(), c.copy(), np.full(40, 1000.0)
    acts = alpha.adjust_actions("XYZ", days, o, h, l, c, v)
    assert len(acts) == 1 and acts[0]["factor"] == pytest.approx(0.5)
    assert np.allclose(c, 100.0) and v[0] == pytest.approx(2000.0)

    d = alpha._day("2025-04-07")
    days = weekdays(d - 30, 40)
    i = int(np.searchsorted(days, d))
    c = np.where(np.arange(40) < i, 1000.0, 570.0)
    o = c.copy()
    acts = alpha.adjust_actions("SIEMENS", days, o, o.copy(), o.copy(), c, np.ones(40))
    assert acts and acts[0]["factor"] == pytest.approx(0.57)
    assert np.allclose(c, 570.0)
    # a large move that is not a known action is left alone
    c2 = np.where(np.arange(40) < i, 1000.0, 570.0)
    assert alpha.adjust_actions("OTHER", days, c2.copy(), c2.copy(), c2.copy(), c2, np.ones(40)) == []
    assert c2[0] == 1000.0
