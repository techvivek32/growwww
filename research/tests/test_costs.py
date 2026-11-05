import datetime as dt

import numpy as np
import pytest

from mnha_research.costs import trade_costs


def day(y, m, d):
    return (dt.date(y, m, d) - dt.date(1970, 1, 1)).days


def one(entry, exit_, side, d, intraday):
    return float(trade_costs(np.array([entry]), np.array([exit_]), np.array([side]), np.array([d]), intraday)[0])


def test_intraday_round_trip_hand_computed():
    # brokerage 20+20; exch 201000*0.0000297; SEBI 201000*1e-6; GST 18% of those;
    # STT 0.025% of the sell leg; stamp 0.003% of the buy leg.
    exch, sebi = 201_000 * 0.0000297, 201_000 * 10 / 1e7
    expected = 40 + exch + sebi + 0.18 * (40 + exch + sebi) + 101_000 * 0.00025 + 100_000 * 0.00003
    assert one(100_000, 101_000, 1, day(2025, 1, 10), True) == pytest.approx(expected, abs=1e-6)
    assert expected == pytest.approx(82.731426, abs=1e-6)


def test_delivery_round_trip_hand_computed():
    exch, sebi = 201_000 * 0.0000297, 201_000 * 10 / 1e7
    expected = 40 + exch + sebi + 0.18 * (40 + exch + sebi) + 201_000 * 0.001 + 100_000 * 0.00015 + 16.0
    assert one(100_000, 101_000, 1, day(2025, 1, 10), False) == pytest.approx(expected, abs=1e-6)


def test_effective_dating_uses_the_rate_in_force():
    old = one(100_000, 101_000, 1, day(2023, 1, 2), True)
    new = one(100_000, 101_000, 1, day(2025, 1, 2), True)
    exch_old = 201_000 * 0.0000325
    sebi = 0.201
    assert old == pytest.approx(40 + exch_old + sebi + 0.18 * (40 + exch_old + sebi) + 25.25 + 3.0, abs=1e-6)
    assert old > new  # NSE's charge fell on 2024-10-01


def test_short_pays_stt_on_its_sell_leg():
    # short: sell 101,000 first, buy back 100,000 — same legs as the long case
    assert one(101_000, 100_000, -1, day(2025, 1, 10), True) == pytest.approx(one(100_000, 101_000, 1, day(2025, 1, 10), True))


def test_brokerage_floor_and_cap():
    small = one(2_000, 2_000, 1, day(2025, 1, 10), True)
    # 0.1% of 2000 = 2 → floored to 5 per leg
    exch, sebi = 4_000 * 0.0000297, 4_000 * 1e-6
    assert small == pytest.approx(10 + exch + sebi + 0.18 * (10 + exch + sebi) + 2_000 * 0.00025 + 2_000 * 0.00003, abs=1e-9)


def test_refuses_dates_without_a_schedule():
    with pytest.raises(ValueError):
        one(100_000, 101_000, 1, day(2002, 5, 1), True)


def test_pre_2012_delivery_stt_is_0_125_pct():
    exch, sebi = 201_000 * 0.000035, 201_000 * 15 / 1e7
    expected = 40 + exch + sebi + 0.18 * (40 + exch + sebi) + 201_000 * 0.00125 + 100_000 * 0.00015 + 16.0
    assert one(100_000, 101_000, 1, day(2010, 3, 1), False) == pytest.approx(expected, abs=1e-6)
    assert one(100_000, 101_000, 1, day(2013, 3, 1), False) < expected  # cut to 0.1% from 2012-07-01


def test_multiplier_scales_everything():
    base = one(100_000, 101_000, 1, day(2025, 1, 10), True)
    double = float(trade_costs(np.array([100_000.0]), np.array([101_000.0]), np.array([1]), np.array([day(2025, 1, 10)]), True, multiplier=2.0)[0])
    assert double == pytest.approx(2 * base)


def test_per_trade_intraday_flags():
    d = 20_400
    v = np.array([100_000.0, 100_000.0])
    both = trade_costs(v, v, np.array([1, 1]), np.array([d, d]), np.array([True, False]))
    assert both[0] == pytest.approx(one(100_000, 100_000, 1, d, True))
    assert both[1] == pytest.approx(one(100_000, 100_000, 1, d, False))
