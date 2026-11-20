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


def _livex_db(tmp_path, monkeypatch):
    from mnha_research import config, db, livex

    monkeypatch.setattr(config, "DB_PATH", tmp_path / "t.sqlite", raising=False)
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.sqlite", raising=False)
    return livex._db()


def _at(day: int, hh: int, mm: int, ss: float = 0.0) -> float:
    """Epoch seconds of IST hh:mm:ss on IST day number `day`."""
    return day * 86_400 + hh * 3600 + mm * 60 + ss - 19_800


def test_mstop_bar_due_checks_each_close_from_0925_to_1510_once_a_few_seconds_after_it():
    from mnha_research import livex

    day = 20_400
    assert livex.mstop_bar_due(_at(day, 9, 20, 5)) is None  # bar 0 is the entry
    assert livex.mstop_bar_due(_at(day, 9, 25, 1)) is None  # too soon after the close
    assert livex.mstop_bar_due(_at(day, 9, 25, 4)) == 1
    assert livex.mstop_bar_due(_at(day, 9, 26, 1)) is None  # more than a minute after it
    assert livex.mstop_bar_due(_at(day, 10, 15, 30)) == livex.FLIP_BAR
    assert livex.mstop_bar_due(_at(day, 15, 10, 10)) == 70 == livex.MSTOP_LAST_BAR
    assert livex.mstop_bar_due(_at(day, 15, 15, 10)) is None  # 15:15 is the square-off, not a stop check
    assert livex.bar_close_minute(0) == 9 * 60 + 20 and livex.bar_close_minute(livex.EXIT_BAR) == 15 * 60 + 15


def test_market_stop_is_recorded_once_when_the_average_stock_is_up_half_a_percent(tmp_path, monkeypatch):
    from mnha_research import livex

    con = _livex_db(tmp_path, monkeypatch)
    day = (pd.Timestamp("2026-11-16") - pd.Timestamp("1970-01-01")).days
    syms = [f"S{i}" for i in range(40)]
    with con:
        con.execute("INSERT INTO livex_days(day, status, skip, pick, pick_px) VALUES(?,?,?,?,?)", (day, "decided", 0, "S0", 100.0))
        con.executemany("INSERT INTO livex_rows(day, symbol, px_0920) VALUES(?,?,?)", [(day, s, 100.0) for s in syms])
    quotes = {"q": {s: 100.4 for s in syms}}
    monkeypatch.setattr(livex, "_ltp_many", lambda symbols: {s: quotes["q"][s] for s in symbols if s in quotes["q"]})
    out = livex.market_stop_check(_at(day, 9, 25, 5), con)
    assert out["checked"] and not out["stop"] and out["mkt"] == pytest.approx(0.004)
    beat = con.execute("SELECT bar, value FROM livex_events WHERE day=? AND kind='mstop_check'", (day,)).fetchone()
    assert beat[0] == 1 and beat[1] == pytest.approx(0.004)  # the watcher's heartbeat
    quotes["q"] = {s: 100.6 for s in syms}
    out = livex.market_stop_check(_at(day, 9, 30, 5), con)
    assert out["stop"] and out["bar"] == 2
    ev = con.execute("SELECT bar, value FROM livex_events WHERE day=? AND kind='mstop'", (day,)).fetchall()
    assert len(ev) == 1 and ev[0][0] == 2 and ev[0][1] == pytest.approx(0.006)
    assert con.execute("SELECT bar FROM livex_events WHERE day=? AND kind='mstop_check'", (day,)).fetchone()[0] == 2
    assert livex.market_stop_check(_at(day, 9, 35, 5), con)["why"] == "already stopped"
    assert livex.market_stop_check(_at(day, 9, 37, 0), con) == {"checked": False, "why": "not at a bar close"}


def test_market_stop_needs_quotes_and_an_open_short(tmp_path, monkeypatch):
    from mnha_research import livex

    con = _livex_db(tmp_path, monkeypatch)
    day = (pd.Timestamp("2026-11-17") - pd.Timestamp("1970-01-01")).days
    syms = [f"S{i}" for i in range(40)]
    with con:
        con.execute("INSERT INTO livex_days(day, status, skip, pick, pick_px, flip) VALUES(?,?,?,?,?,?)", (day, "flipped", 0, "S0", 100.0, 1))
        con.executemany("INSERT INTO livex_rows(day, symbol, px_0920) VALUES(?,?,?)", [(day, s, 100.0) for s in syms])
    monkeypatch.setattr(livex, "_ltp_many", lambda symbols: {s: 101.0 for s in symbols[:10]})
    out = livex.market_stop_check(_at(day, 9, 50, 5), con)  # before 10:15 the short is still open: 10 of 40 quotes is too few
    assert out["checked"] is False and "quotes" in out["why"]
    assert livex.market_stop_check(_at(day, 10, 30, 5), con)["why"] == "the short was covered by the 10:15 flip"
    with con:
        con.execute("UPDATE livex_days SET status='decided', flip=NULL, skip=1 WHERE day=?", (day,))
    assert livex.market_stop_check(_at(day, 9, 50, 5), con)["why"] == "no open short"  # a regime-skip day takes nothing
    assert con.execute("SELECT COUNT(*) FROM livex_events").fetchone()[0] == 0


def test_today_state_reports_the_pick_the_live_flip_and_the_stop(tmp_path, monkeypatch):
    import json

    from mnha_research import live, livex

    con = _livex_db(tmp_path, monkeypatch)
    day = (pd.Timestamp("2026-11-18") - pd.Timestamp("1970-01-01")).days
    now = _at(day, 10, 20, 0)
    empty = livex.today_state(now)
    assert empty["day"] == day and empty["status"] is None and empty["flip"] is None and empty["mstop"] is None
    assert empty["mstop_check"] is None
    with con:
        con.execute("INSERT INTO livex_days(day, status, skip, pick, pick_px, decided_at, info) VALUES(?,?,?,?,?,?,?)",
                    (day, "decided", 0, "TCS", 3000.0, _at(day, 9, 20, 40), json.dumps({"late": False})))
    st = livex.today_state(now)
    assert (st["status"], st["skip"], st["pick"], st["pick_px"], st["late"]) == ("decided", False, "TCS", 3000.0, False)
    with con:
        con.execute("UPDATE livex_days SET flip=1, flip_symbol='INFY', flip_px=1500.0 WHERE day=?", (day,))
    assert livex.today_state(now)["flip"] is None  # a flip worked out by settle() was never decided live
    with con:
        con.execute("UPDATE livex_days SET status='flipped', flip_at=? WHERE day=?", (_at(day, 10, 16, 0), day))
        con.execute("INSERT INTO livex_events(day, kind, at, bar, value) VALUES(?,?,?,?,?)", (day, "mstop", _at(day, 9, 45, 4), 5, 0.0061))
        con.execute("INSERT INTO livex_events(day, kind, at, bar, value) VALUES(?,?,?,?,?)", (day, "mstop_check", _at(day, 9, 45, 4), 5, 0.0061))
    st = livex.today_state(now)
    assert st["flip"] == {"at": _at(day, 10, 16, 0), "do": True, "symbol": "INFY", "px": 1500.0}
    assert st["mstop"]["bar"] == 5 and st["mstop"]["move"] == pytest.approx(0.0061)
    assert st["mstop_check"] == {"at": _at(day, 9, 45, 4), "bar": 5, "move": pytest.approx(0.0061)}
    assert live.today_ist(now) == day
