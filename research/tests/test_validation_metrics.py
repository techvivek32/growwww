import numpy as np
import pytest
from scipy import stats

from mnha_research import validation as v
from mnha_research.metrics import AggTable, max_drawdown


def test_split_is_chronological():
    days = np.arange(100)
    a, b = v.split_days(days)
    assert (a, b) == (60, 80)


def test_bh_fdr_textbook_example():
    p = np.array([0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216])
    assert v.bh_fdr(p, q=0.05).tolist() == [True, True] + [False] * 8


def test_pbo_is_high_for_noise_and_low_for_a_real_edge():
    rng = np.random.default_rng(1)
    noise = rng.normal(0, 1, (60, 40))
    assert 0.25 <= v.pbo(noise)["pbo"] <= 0.75
    edge = noise.copy()
    edge[:, 0] += 1.5
    assert v.pbo(edge)["pbo"] < 0.1


def test_more_trials_deflate_sharpe_more():
    rng = np.random.default_rng(2)
    r = rng.normal(0.002, 0.01, 500)
    few = v.deflated_sharpe(r, 10, 0.004)["dsr"]
    many = v.deflated_sharpe(r, 100_000, 0.004)["dsr"]
    assert many < few


def test_monte_carlo_is_seeded():
    net = np.random.default_rng(3).normal(10, 100, 200)
    assert v.monte_carlo(net) == v.monte_carlo(net)
    mc = v.monte_carlo(net)
    assert mc["total_p5"] < mc["total_p50"] < mc["total_p95"]


def test_portfolio_caps_positions_and_one_per_symbol():
    entry = np.array([0, 0, 0, 0, 10], dtype=np.int64) * 1000
    exit_ = np.array([5, 5, 5, 5, 12], dtype=np.int64) * 1000
    net = np.ones(5)
    sym = np.array([1, 1, 2, 3, 1])
    taken, _ = v.portfolio_curve(entry, exit_, net, sym, max_pos=2)
    assert taken.tolist() == [True, False, True, False, True]


def test_walk_forward_selection_rewards_persistent_edge():
    rng = np.random.default_rng(4)
    F = rng.normal(0, 1, (50, 6))
    F[:5] += 3
    res = v.walk_forward_selection(F, top=5)
    assert res["picked_beat_all"] == 1.0


def test_agg_moments_match_scipy_and_add_up():
    rng = np.random.default_rng(5)
    net = rng.normal(50, 500, 400)
    notional = np.full(400, 100_000.0)
    bars = np.ones(400)
    t = AggTable(1)
    t.add(0, net[:150], np.zeros(150), notional[:150], bars[:150], 1)
    t.add(0, net[150:], np.zeros(250), notional[150:], bars[150:], 2)
    r = net / notional
    mean, sd, skew, kurt = t.moments(0)
    assert mean == pytest.approx(r.mean())
    assert sd == pytest.approx(r.std(ddof=1))
    assert skew == pytest.approx(stats.skew(r))
    assert kurt == pytest.approx(stats.kurtosis(r, fisher=False))
    row = t.row(0)
    assert row["trades"] == 400 and row["symbols"] == 2
    assert row["net_pnl"] == pytest.approx(net.sum())
    assert row["profit_factor"] == pytest.approx(net[net > 0].sum() / -net[net <= 0].sum())


def test_max_drawdown():
    assert max_drawdown(np.array([10.0, -5, -10, 20, -30])) == pytest.approx(30.0)
