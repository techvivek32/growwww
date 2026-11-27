"""F&O paper legs: contract choice, fills, charges and P&L (no network)."""
import datetime as dt

from mnha_research import fno

ROWS = [{"underlying_symbol": "X", "instrument_type": "FUT", "expiry_date": "2026-11-24", "trading_symbol": "X26NOVFUT", "lot_size": "225", "strike_price": "0"},
        {"underlying_symbol": "X", "instrument_type": "FUT", "expiry_date": "2026-12-29", "trading_symbol": "X26DECFUT", "lot_size": "225", "strike_price": "0"},
        {"underlying_symbol": "X", "instrument_type": "CE", "expiry_date": "2026-12-29", "trading_symbol": "X26DEC1900CE", "lot_size": "225", "strike_price": "1900"},
        {"underlying_symbol": "X", "instrument_type": "CE", "expiry_date": "2026-12-29", "trading_symbol": "X26DEC1920CE", "lot_size": "225", "strike_price": "1920"},
        {"underlying_symbol": "X", "instrument_type": "PE", "expiry_date": "2026-12-29", "trading_symbol": "X26DEC1900PE", "lot_size": "225", "strike_price": "1900"}]
DAY = dt.date(2026, 11, 27)


def test_near_month_and_atm():
    assert fno.contract("X", "FUT", 1905.0, DAY, ROWS)["trading_symbol"] == "X26DECFUT"  # the expired November contract is skipped
    assert fno.contract("X", "CE", 1912.0, DAY, ROWS)["trading_symbol"] == "X26DEC1920CE"
    assert fno.contract("X", "CE", 1905.0, DAY, ROWS)["trading_symbol"] == "X26DEC1900CE"
    assert fno.contract("X", "PE", 1905.0, DAY, ROWS)["strike"] == 1900.0


def test_charges_and_slip():
    fut = fno.charges("FUT", 1905.7 * 225, 1915.0 * 225)
    opt = fno.charges("CE", 80.0 * 225, 90.0 * 225)
    assert 140 < fut < 180 and 70 < opt < 100
    assert fno.slip("CE", 80.0) == 0.4 and fno.slip("FUT", 1900.0) == 1900.0 * 3e-4


def test_close_pnl_long_and_short():
    r = {"kind": "FUT", "side": "short", "entry": 1900.0, "qty": 225}
    fno._close(r, 1890.0, 0.0, "t")
    assert r["exit"] > 1890.0 and r["gross"] > 0 and r["net"] == round(r["gross"] - r["costs"], 2)
    o = {"kind": "CE", "side": "long", "entry": 80.4, "qty": 225}
    fno._close(o, 70.0, 0.0, "t")
    assert o["exit"] == 69.65 and o["gross"] < 0
