import numpy as np
import pandas as pd
import pytest

from mnha_research import indicators as ind

rng = np.random.default_rng(7)
C = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 400)))
H = C * (1 + np.abs(rng.normal(0, 0.005, 400)))
L = C * (1 - np.abs(rng.normal(0, 0.005, 400)))


def test_sma_matches_pandas():
    ref = pd.Series(C).rolling(20).mean().to_numpy()
    np.testing.assert_allclose(ind.sma(C, 20), ref, equal_nan=True)


def test_ema_seeded_with_sma():
    n = 10
    out = ind.ema(C, n)
    a = 2 / (n + 1)
    prev = C[:n].mean()
    assert np.isnan(out[: n - 1]).all()
    assert out[n - 1] == pytest.approx(prev)
    for i in range(n, len(C)):
        prev = a * C[i] + (1 - a) * prev
        assert out[i] == pytest.approx(prev)


def test_rsi_wilder_reference():
    n = 14
    d = np.diff(C)
    up, dn = np.clip(d, 0, None), np.clip(-d, 0, None)
    au, ad = up[:n].mean(), dn[:n].mean()
    out = ind.rsi(C, n)
    assert np.isnan(out[:n]).all()
    assert out[n] == pytest.approx(100 - 100 / (1 + au / ad))
    for i in range(n, len(d)):
        au = (au * (n - 1) + up[i]) / n
        ad = (ad * (n - 1) + dn[i]) / n
        assert out[i + 1] == pytest.approx(100 - 100 / (1 + au / ad))


def test_atr_reference():
    n = 14
    tr = np.maximum(H[1:] - L[1:], np.maximum(np.abs(H[1:] - C[:-1]), np.abs(L[1:] - C[:-1])))
    tr = np.concatenate([[H[0] - L[0]], tr])
    a = tr[:n].mean()
    out = ind.atr(H, L, C, n)
    assert out[n - 1] == pytest.approx(a)
    for i in range(n, len(C)):
        a = (a * (n - 1) + tr[i]) / n
        assert out[i] == pytest.approx(a)


def test_prior_max_excludes_current_bar():
    x = np.array([1.0, 5, 2, 3, 9, 1])
    out = ind.prior_max(x, 3)
    assert np.isnan(out[:3]).all()
    assert list(out[3:]) == [5, 5, 9]


def test_prior_mean_excludes_current_bar():
    x = np.array([1.0, 2, 3, 100])
    assert ind.prior_mean(x, 3)[3] == pytest.approx(2.0)


def test_vwap_resets_each_session():
    h = np.array([10.0, 12, 20, 22])
    l = np.array([10.0, 12, 20, 22])
    c = np.array([10.0, 12, 20, 22])
    v = np.array([1.0, 1, 1, 3])
    day = np.array([1, 1, 2, 2])
    out = ind.session_vwap(h, l, c, v, day)
    assert out[1] == pytest.approx(11)
    assert out[2] == pytest.approx(20)  # new day ignores day 1
    assert out[3] == pytest.approx((20 + 66) / 4)


def test_cross_semantics_and_nan():
    a = np.array([np.nan, 1.0, 3.0, 2.0, 4.0])
    b = np.array([2.0, 2.0, 2.0, 2.0, 2.0])
    assert list(ind.cross_above(a, b)) == [False, False, True, False, True]
    assert list(ind.cross_below(a, b)) == [False, False, False, False, False]  # 3 -> 2 is not below 2


def test_adx_bounded_and_strong_in_trend():
    t = np.arange(300, dtype=float)
    c = 100 + t
    h, l = c + 0.5, c - 0.5
    pdi, ndi, ax = ind.adx(h, l, c, 14)
    ok = ~np.isnan(ax)
    assert ((ax[ok] >= 0) & (ax[ok] <= 100)).all()
    assert ax[-1] > 50 and pdi[-1] > ndi[-1]


def test_supertrend_flips_on_reversal():
    c = np.concatenate([np.linspace(100, 150, 80), np.linspace(150, 90, 80)])
    d = ind.supertrend_dir(c + 1, c - 1, c, 10, 3.0)
    assert d[70] == 1 and d[-1] == -1


def test_opening_range_only_after_window():
    # 15m bars 09:15.. ; 30-minute window = first two bars
    minute = np.array([555, 570, 585, 600])
    day = np.array([1, 1, 1, 1])
    h = np.array([10.0, 12, 11, 13])
    l = np.array([9.0, 8, 10, 12])
    oh, ol = ind.opening_range(h, l, minute, day, 555, 30, 15)
    assert np.isnan(oh[:2]).all()
    assert oh[2] == 12 and ol[2] == 8
