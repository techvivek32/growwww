import numpy as np
import pytest

from mnha_research.refine import _walk

M = np.array([555 + 5 * i for i in range(75)], dtype=np.int64)  # 09:15 .. 15:25


def bars(path):
    c = np.array(path, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    return M[: len(c)], o, np.maximum(o, c) * 1.001, np.minimum(o, c) * 0.999, c


def test_short_held_to_the_exit_bar():
    b = bars([100.0] * 75)
    e, x, why = _walk(*b, 560, 915, 0.0, 0.0, 0.0)
    assert e == 100.0 and why == 0 and x == 100.0


def test_stop_and_target():
    path = [100.0] * 3 + [101.5, 103.0] + [103.0] * 70
    e, x, why = _walk(*bars(path), 560, 915, 0.02, 0.0, 0.0)
    assert why == 1 and x == pytest.approx(102.0)
    path = [100.0] * 3 + [99.5, 98.4] + [98.0] * 70
    e, x, why = _walk(*bars(path), 560, 915, 0.02, 0.01, 0.0)
    assert why == 2 and x == pytest.approx(99.0)


def test_entry_bar_must_exist():
    e, x, why = _walk(*bars([100.0] * 75), 561, 915, 0.0, 0.0, 0.0)
    assert np.isnan(e) and why == -1
