import numpy as np
import pytest

from mnha_research.lab import NB, TICK_CHANGE_DAY, _walk, bar_close_minute, bar_of, tick_size


def path(closes):
    c = np.array(closes + [closes[-1]] * (NB - len(closes)), dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    return o, np.maximum(o, c), np.minimum(o, c), c


def test_bar_clock():
    assert bar_of("09:20") == 0 and bar_of("15:15") == NB - 1 and bar_close_minute(0) == 9 * 60 + 20


def test_short_time_exit_with_slippage():
    e, x, b, why = _walk(*path([100.0, 99.0, 98.0]), -1, 0, NB - 1, 0.0, 0.0, 0.0, 0.001)
    assert e == pytest.approx(99.9) and x == pytest.approx(98.0 * 1.001) and why == 0 and b == NB - 1


def test_short_stop_and_target_and_gap():
    e, x, b, why = _walk(*path([100.0, 100.5, 102.5]), -1, 0, NB - 1, 0.02, 0.0, 0.0, 0.0)
    assert why == 1 and x == pytest.approx(102.0) and b == 2  # touched inside the bar: filled at the stop
    o, h, l, c = path([100.0, 100.5, 103.0])
    o[2] = 102.8  # opened through the stop: filled at that open
    e, x, b, why = _walk(o, h, l, c, -1, 0, NB - 1, 0.02, 0.0, 0.0, 0.0)
    assert why == 1 and x == pytest.approx(102.8) and b == 2
    e, x, b, why = _walk(*path([100.0, 99.5, 98.9]), -1, 0, NB - 1, 0.02, 0.01, 0.0, 0.0)
    assert why == 2 and x == pytest.approx(99.0)


def test_long_trailing_stop():
    e, x, b, why = _walk(*path([100.0, 102.0, 104.0, 103.0, 101.0]), 1, 0, NB - 1, 0.0, 0.0, 0.02, 0.0)
    assert why == 1 and x == pytest.approx(104.0 * 0.98) and b == 4


def test_exit_bar_respected():
    e, x, b, why = _walk(*path([100.0, 101.0, 102.0, 103.0]), 1, 0, 2, 0.0, 0.0, 0.0, 0.0)
    assert b == 2 and x == pytest.approx(102.0)


def test_tick_size_and_half_tick_slippage_floor():
    before, after = TICK_CHANGE_DAY - 1, TICK_CHANGE_DAY
    assert list(tick_size(np.array([10.0, 10.0, 300.0]), np.array([before, after, after]))) == [0.05, 0.01, 0.05]
    # a Rs 10 stock on a 0.05 tick: half a tick is 25 bps, far above the flat 3 bps
    assert 0.5 * 0.05 / 10.0 == pytest.approx(0.0025)
