import numpy as np
import pandas as pd
import pytest

from mnha_research import engine
from mnha_research.series import Series

from conftest import epoch_ms

SLIP = 0.0003
D0 = 20_100  # an IST day number in 2025


def frame(o, h, l, c, interval=15, day=D0):
    n = len(o)
    times = [epoch_ms(day, 9 * 60 + 15 + i * interval) for i in range(n)]
    return pd.DataFrame({"time": times, "open": o, "high": h, "low": l, "close": c, "volume": [1000.0] * n})


def base(n=25):
    """Quiet tradable bars around 100: open = close = 100, range ±0.2 (well inside 1 ATR)."""
    return [100.0] * n, [100.2] * n, [99.8] * n, [100.0] * n


def run_kernel(s: Series, el, es=None, xl=None, xs=None, stop=1.0, tgt=2.0, trail=0.0, time_stop=0, hold=-1, intraday=None):
    n = len(s)
    z = np.zeros(n, dtype=bool)
    es = z if es is None else es
    xl = z if xl is None else xl
    xs = z if xs is None else xs
    atr = np.full(n, 1.0)
    intraday = s.interval < 1440 if intraday is None else intraday
    return engine.kernel(s.o, s.h, s.l, s.c, s.sess.squareoff, s.sess.entry_ok, el, es, xl, xs, atr,
                         stop, tgt, trail, time_stop, SLIP, intraday, s.sess.sord, s.sess.sess_end, hold)


def sig_at(n, i):
    a = np.zeros(n, dtype=bool)
    a[i] = True
    return a


def test_entry_is_next_bar_open_with_slippage_and_target_fill():
    o, h, l, c = base()
    o[3] = 100.1
    h[3] = 100.3
    h[4] = 102.5
    s = Series("T", 15, frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(25, 2))
    assert e_i[0] == 3 and side[0] == 1
    assert epx[0] == pytest.approx(100.1 * (1 + SLIP))  # bar 3's open, not bar 2's close
    assert why[0] == engine.TARGET and x_i[0] == 4
    assert xpx[0] == pytest.approx(epx[0] + 2.0)  # a limit target: no slippage


def test_stop_intrabar_with_slippage():
    o, h, l, c = base()
    l[5] = 98.0
    s = Series("T", 15, frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(25, 2))
    stop = 100 * (1 + SLIP) - 1.0
    assert why[0] == engine.STOP and x_i[0] == 5
    assert xpx[0] == pytest.approx(stop * (1 - SLIP))


def test_gap_through_stop_exits_at_open_not_stop():
    o, h, l, c = base()
    o[5], h[5], l[5], c[5] = 95.0, 95.5, 94.0, 95.0
    s = Series("T", 15, frame(o, h, l, c))
    *_, xpx, why = run_kernel(s, sig_at(25, 2))
    assert why[0] == engine.STOP_GAP
    assert xpx[0] == pytest.approx(95.0 * (1 - SLIP))


def test_stop_and_target_in_one_bar_counts_as_stop():
    o, h, l, c = base()
    h[5], l[5] = 105.0, 95.0
    s = Series("T", 15, frame(o, h, l, c))
    *_, why = run_kernel(s, sig_at(25, 2))
    assert why[0] == engine.STOP


def test_intraday_square_off_at_1515():
    o, h, l, c = base()
    c[23], h[23] = 100.5, 100.6
    s = Series("T", 15, frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(25, 2), stop=50, tgt=0)
    assert x_i[0] == 23 and why[0] == engine.EOD  # bar 23 opens 15:00, ends 15:15
    assert xpx[0] == pytest.approx(100.5 * (1 - SLIP))


def test_no_entry_after_cutoff():
    s = Series("T", 15, frame(*base()))
    # bar 22 opens 14:45: a signal on bar 21 may enter there; bar 22's may not (next opens 15:00)
    assert s.sess.entry_ok[21] and not s.sess.entry_ok[22]
    e_i, *_ = run_kernel(s, sig_at(25, 22))
    assert len(e_i) == 0


def test_no_signal_carries_into_the_next_session():
    o, h, l, c = base(50)
    times = [epoch_ms(D0, 9 * 60 + 15 + i * 15) for i in range(25)] + [epoch_ms(D0 + 1, 9 * 60 + 15 + i * 15) for i in range(25)]
    df = pd.DataFrame({"time": times, "open": o, "high": h, "low": l, "close": c, "volume": [1.0] * 50})
    s = Series("T", 15, df)
    assert not s.sess.entry_ok[24]
    e_i, *_ = run_kernel(s, sig_at(50, 24))
    assert len(e_i) == 0


def test_short_trade_pnl_sign():
    o, h, l, c = base()
    l[6] = 97.0
    s = Series("T", 15, frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, np.zeros(25, dtype=bool), es=sig_at(25, 2))
    assert side[0] == -1 and why[0] == engine.TARGET
    assert epx[0] == pytest.approx(100 * (1 - SLIP))  # a short sells lower
    assert xpx[0] == pytest.approx(epx[0] - 2.0)


def test_one_position_at_a_time():
    s = Series("T", 15, frame(*base()))
    el = np.zeros(25, dtype=bool)
    el[2:10] = True
    e_i, *_ = run_kernel(s, el, stop=50, tgt=0)
    assert len(e_i) == 1


def test_locked_bar_drops_entry():
    n = 25
    flat = [100.0] * n
    s = Series("T", 15, frame(flat, flat, flat, flat))  # high == low on every bar: circuit-locked
    e_i, *_ = run_kernel(s, sig_at(n, 2))
    assert len(e_i) == 0


def test_opposite_signal_exits_next_open():
    o, h, l, c = base()
    o[8] = 100.4
    h[8] = 100.5
    s = Series("T", 15, frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(25, 2), xl=sig_at(25, 6), stop=50, tgt=0)
    assert why[0] == engine.OPP and x_i[0] == 7
    assert xpx[0] == pytest.approx(100.0 * (1 - SLIP))


def daily_frame(o, h, l, c):
    n = len(o)
    times = [epoch_ms(D0 + i, 9 * 60 + 15) for i in range(n)]
    return pd.DataFrame({"time": times, "open": o, "high": h, "low": l, "close": c, "volume": [1000.0] * n})


def test_swing_time_stop():
    n = 30
    c = [100.0 + i for i in range(n)]
    o = [x - 0.2 for x in c]
    h = [x + 0.5 for x in c]
    l = [x - 0.6 for x in c]
    s = Series("T", 1440, daily_frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(n, 2), stop=1.0, tgt=0.0, time_stop=5)
    assert why[0] == engine.TIME and x_i[0] - e_i[0] + 1 == 5
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(n, 2), stop=1.0, tgt=0.0, trail=1.0, time_stop=20)
    assert why[0] == engine.TIME  # a steady rise never pulls back to a 1-ATR trail


def test_trailing_stop_exits_on_pullback():
    n = 20
    c = [100, 100, 100, 101, 102, 103, 104, 105, 103.5, 103.0] + [103.0] * 10
    c = [float(x) for x in c]
    s = Series("T", 1440, daily_frame(list(c), [x + 0.1 for x in c], [x - 0.1 for x in c], c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(n, 2), stop=3.0, tgt=0.0, trail=1.0, time_stop=40)
    # best close 105 → trail stop 104; bar 8 opens 103.5, below it → exits at that open
    assert x_i[0] == 8 and why[0] == engine.STOP_GAP


def test_run_applies_costs_and_qty():
    o, h, l, c = base()
    h[5] = 103.0
    s = Series("T", 15, frame(o, h, l, c))
    d = {"exit": {"stop": 1.0, "target": 2.0, "trail": 0.0, "time": 0}}
    z = np.zeros(25, dtype=bool)
    tr = engine.run(s, d, (sig_at(25, 2), z, z, z), np.full(25, 1.0), slippage_bps=3.0)
    assert len(tr) == 1
    assert tr.qty[0] == int(100_000 // tr.entry_px[0])
    assert tr.gross[0] == pytest.approx((tr.exit_px[0] - tr.entry_px[0]) * tr.qty[0])
    assert 0 < tr.costs[0] < 100 and tr.net[0] == pytest.approx(tr.gross[0] - tr.costs[0])


# ---------------------------------------------------------------- short-hold program (v2)
def multi_day_frame(days, interval=15):
    rows = []
    for d in days:
        m = 9 * 60 + 15
        while m < 15 * 60 + 30:
            rows.append(epoch_ms(d, m))
            m += interval
    n = len(rows)
    return pd.DataFrame({"time": rows, "open": [100.0] * n, "high": [100.2] * n, "low": [99.8] * n, "close": [100.0] * n,
                         "volume": [1000.0] * n})


def test_daily_hold_zero_buys_the_open_sells_the_close():
    n = 10
    o, h, l, c = [100.0] * n, [101.0] * n, [99.5] * n, [100.0] * n
    o[3], c[3] = 100.0, 100.8
    s = Series("T", 1440, daily_frame(o, h, l, c))
    e_i, x_i, side, epx, xpx, why = run_kernel(s, sig_at(n, 2), stop=5.0, tgt=0.0, hold=0)
    assert e_i[0] == 3 and x_i[0] == 3 and why[0] == engine.TIME
    assert xpx[0] == pytest.approx(100.8 * (1 - SLIP))


def test_daily_hold_n_exits_at_the_nth_close_after_entry():
    n = 12
    o, h, l, c = [100.0] * n, [101.0] * n, [99.5] * n, [100.0] * n
    s = Series("T", 1440, daily_frame(o, h, l, c))
    for hold in (1, 2, 3):
        e_i, x_i, *_, why = run_kernel(s, sig_at(n, 2), stop=5.0, tgt=0.0, hold=hold)
        assert e_i[0] == 3 and x_i[0] == 3 + hold and why[0] == engine.TIME


def test_intraday_carry_exits_at_the_square_off_bar_n_sessions_later():
    days = [D0, D0 + 1, D0 + 2, D0 + 3]
    s = Series("T", 15, multi_day_frame(days))
    n = len(s)
    for hold in (1, 2):
        e_i, x_i, *_, why = run_kernel(s, sig_at(n, 4), stop=50.0, tgt=0.0, hold=hold, intraday=False)
        assert s.sess.day[e_i[0]] == D0 and s.sess.day[x_i[0]] == D0 + hold
        assert s.sess.squareoff[x_i[0]] and not s.sess.squareoff[x_i[0] - 1] and why[0] == engine.TIME
    # without a hold an intraday position never sees the next session
    e_i, x_i, *_, why = run_kernel(s, sig_at(n, 4), stop=50.0, tgt=0.0)
    assert s.sess.day[x_i[0]] == D0 and why[0] == engine.EOD


def test_costs_follow_the_session_the_trade_closed_in():
    days = [D0, D0 + 1]
    s = Series("T", 15, multi_day_frame(days))
    n = len(s)
    z = np.zeros(n, dtype=bool)
    sig = (sig_at(n, 4), z, z, z)
    base_ex = {"stop": 50.0, "target": 0.0, "trail": 0.0, "opp": False, "time": 0}
    intra = engine.run(s, {"exit": {**base_ex, "hold": 0}}, sig, np.full(n, 1.0))
    carry = engine.run(s, {"exit": {**base_ex, "hold": 1}}, sig, np.full(n, 1.0))
    assert s.sess.day[intra.x_i[0]] == D0 and s.sess.day[carry.x_i[0]] == D0 + 1
    # ₹1 lakh round trip. Delivery: STT 0.1% on both legs, stamp 0.015%, DP ≈ ₹285;
    # intraday: STT 0.025% on the sell leg, stamp 0.003% ≈ ₹82
    assert carry.costs[0] > 250 and 60 < intra.costs[0] < 100
