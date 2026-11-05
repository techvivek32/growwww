import numpy as np
import pandas as pd
import pytest

from mnha_research import lab, live
from mnha_research.lab import NB, _walk


def path(closes):
    c = np.array(closes + [closes[-1]] * (NB - len(closes)), dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    return o, np.maximum(o, c), np.minimum(o, c), c


@pytest.mark.parametrize("closes,stop", [([100.0, 99.0, 98.0], 0.0), ([100.0, 100.5, 102.5], 0.02), ([100.0, 101.0, 104.0, 103.0], 0.03),
                                         ([100.0, 99.5, 98.9, 97.0], 0.01)])
def test_live_walk_is_the_lab_walk_without_a_market_stop(closes, stop):
    o, h, l, c = path(closes)
    slip = 0.0005
    e, x, b, why = _walk(o, h, l, c, -1, 0, NB - 1, stop, 0.0, 0.0, slip)
    x2, b2, why2 = live._walk_live(o, h, l, c, -1, e, 0, NB - 1, stop, slip, np.zeros(NB), 0.0)
    assert (x2, b2, why2) == pytest.approx((x, b, why))


def test_market_stop_covers_at_the_close_of_the_bar_where_the_average_stock_is_up():
    o, h, l, c = path([100.0] * 10)
    mkt = np.zeros(NB)
    mkt[4] = 0.006  # the average eligible stock is up 0.6% since 09:20 at bar 4's close
    x, b, why = live._walk_live(o, h, l, c, -1, 100.0, 0, NB - 1, 0.03, 0.0, mkt, 0.005)
    assert (b, why) == (4, 5) and x == pytest.approx(100.0)
    x, b, why = live._walk_live(o, h, l, c, -1, 100.0, 0, NB - 1, 0.03, 0.0, mkt, 0.0)  # no market stop
    assert (b, why) == (NB - 1, 0)


def test_price_book_charges_tick_slippage_and_costs():
    a = np.stack(list(path([10.0, 9.9, 9.8])) + [np.ones(NB)])  # a Rs 10 stock: half a 0.05 tick is 25 bps
    picks = pd.DataFrame({"symbol": ["X"], "side": [-1], "rank": [1]})
    day = lab.TICK_CHANGE_DAY - 1
    T = live.price_book({"k": 1, "stop": 0.0, "mstop": 0.0}, picks, {"X": a}, np.zeros(NB), day)
    r = T.iloc[0]
    assert r.entry == pytest.approx(10.0 * (1 - 0.0025)) and r.exit == pytest.approx(9.8 * (1 + 0.0025))
    assert r.qty == np.floor(500_000 / r.entry) and r.costs > 0 and r.net == pytest.approx(r.gross - r.costs)


def test_picks_take_the_lowest_scores_per_book():
    df = pd.DataFrame({"symbol": list("ABCDE"), "score": [0.3, -0.2, 0.1, -0.5, np.nan], "px_0920": 1.0})
    pk = live.picks(df)
    assert list(pk["k1"].symbol) == ["D"] and list(pk["k3"].symbol) == ["D", "B", "C"]
