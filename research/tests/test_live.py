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


def test_livex_expiry_days_and_flip_decision():
    import datetime as dt

    from mnha_research import livex

    d = lambda s: (dt.date.fromisoformat(s) - dt.date(1970, 1, 1)).days  # noqa: E731
    assert livex.expiry_days(d("2026-10-21")) == 4.0  # last Tuesday 2026-10-27: Thu, Fri, Mon, Tue
    assert livex.expiry_days(d("2026-10-27")) == 0.0 and np.isnan(livex.expiry_days(d("2026-10-28")))
    assert livex.expiry_days(d("2025-08-20")) == 6.0  # last Thursday 2025-08-28
    P = {}
    for sym, o0, c11 in (("A", 100.0, 101.0), ("B", 200.0, 200.4), ("C", 40.0, 44.0)):
        a = np.full((5, NB), np.nan)
        a[0] = o0; a[3] = c11; a[3, 0] = o0; a[1] = np.maximum(a[0], a[3]); a[2] = np.minimum(a[0], a[3]); a[4] = 1.0
        P[sym] = a
    do, top, med = livex.flip_decision(P)
    assert do and top == "A" and med == pytest.approx(0.01)  # C is the top gainer but below the Rs 50 floor
    P["A"][3, 1:] = 100.1  # moves 0.1%, 0.2%, 10%: the median 0.2% is below the 0.25% threshold
    assert livex.flip_decision(P)[0] is False


def test_session_book_b_records_a_stop_exit_with_costs(tmp_path, monkeypatch):
    import datetime as dt

    from mnha_research import config, db, livex_session as S

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.sqlite", raising=False)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.sqlite", raising=False)
    day = (dt.date(2026, 11, 16) - dt.date(1970, 1, 1)).days
    con = S._db()
    S._open_leg(con, day, "short", "TCS", -1, 3000.0, 1.0)
    legs = S._open_legs(con, day)
    assert len(legs) == 1 and legs[0][1] == "TCS" and legs[0][3] == pytest.approx(3000.0 * (1 - 3e-4))
    S._close_leg(con, day, "short", 3000.0 * 1.006, 2.0, "stop 0.5%")
    r = con.execute("SELECT exit, why, net, qty FROM livex_fast WHERE day=? AND leg='short'", (day,)).fetchone()
    assert r[1] == "stop 0.5%" and r[0] == pytest.approx(3000.0 * 1.006 * (1 + 3e-4))
    assert r[2] < -0.006 * 500_000 * 0.9 and r[3] == np.floor(500_000 / (3000.0 * (1 - 3e-4)))
    assert S._open_legs(con, day) == []
