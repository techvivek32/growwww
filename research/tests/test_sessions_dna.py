import numpy as np
import pytest

from mnha_research import dna
from mnha_research.sessions import align, close_times, ist_minute

from conftest import epoch_ms

D = 20_100


def test_last_hourly_bar_closes_at_session_close():
    t = np.array([epoch_ms(D, 9 * 60 + 15 + 60 * i) for i in range(7)], dtype=np.int64)
    ct = close_times(t, 60)
    assert ist_minute(ct[-2:] - 0).tolist() == [15 * 60 + 15, 15 * 60 + 30]


def test_daily_value_reaches_intraday_only_after_the_day_closes():
    daily_t = np.array([epoch_ms(D - 1, 555), epoch_ms(D, 555)], dtype=np.int64)
    daily_close = close_times(daily_t, 1440)
    intraday = np.array([epoch_ms(D, 555), epoch_ms(D, 14 * 60), epoch_ms(D + 1, 555)], dtype=np.int64)
    out = align(close_times(intraday, 15), daily_close, np.array([1.0, 2.0]))
    # day D's own bar is not final until 15:30, so D's intraday bars see D-1
    assert out.tolist() == [1.0, 1.0, 2.0]


def test_hourly_value_reaches_15m_bar_when_the_hour_closes():
    h_t = np.array([epoch_ms(D, 555), epoch_ms(D, 615)], dtype=np.int64)  # 09:15, 10:15
    h_close = close_times(h_t, 60)
    m_t = np.array([epoch_ms(D, 600), epoch_ms(D, 585), epoch_ms(D, 615)], dtype=np.int64)  # 10:00, 09:45, 10:15
    out = align(close_times(m_t, 15), h_close, np.array([7.0, 8.0]))
    assert out[0] == 7.0  # 10:00–10:15 bar closes with the 09:15 hour
    assert np.isnan(out[1])  # 09:45–10:00: the first hour is still open
    assert out[2] == 7.0  # 10:15–10:30: the 10:15 hour is still open


def test_generation_is_deterministic_unique_and_balanced():
    a = dna.generate(1600, seed=11)
    b = dna.generate(1600, seed=11)
    assert [x[1] for x in a] == [x[1] for x in b]
    assert len({x[1] for x in a}) == 1600
    fams = [x[2]["family"] for x in a]
    assert all(fams.count(f) == 200 for f in dna.FAMILIES)
    ids = [x[0] for x in a]
    assert len(set(ids)) == 1600


def test_definitions_are_canonical_and_valid():
    for _id, h, d in dna.generate(800, seed=3):
        assert dna.normalise(d) == d
        assert dna.dna_hash(d) == h
        if d["tf"] == 1440:
            assert d["side"] == "long" and d["exit"]["time"] > 0
        else:
            assert d["exit"]["time"] == 0
        kinds = [f["f"] for f in d["filters"]]
        assert len(kinds) == len(set(kinds))
        assert ("htf_trend" in kinds) == (d["family"] == "mtf")
        for f in d["filters"]:
            if f["f"] == "htf_trend":
                assert f["htf"] > d["tf"]


def test_neighbours_differ_by_one_parameter():
    _id, _h, d = dna.generate(8, seed=5)[0]
    for n in dna.neighbours(d):
        assert dna.dna_hash(n) != dna.dna_hash(d)
        diff = [k for k in d["entry"] if d["entry"][k] != n["entry"][k]] + [k for k in d["exit"] if d["exit"][k] != n["exit"][k]]
        assert len(diff) == 1


def test_full_target_is_reachable():
    out = dna.generate(100_000, seed=20261103)
    assert len(out) == 100_000 and len({h for _, h, _ in out}) == 100_000


def test_short_program_is_deterministic_unique_and_within_three_sessions():
    a = dna.generate(900, seed=7, version=dna.SHORT_VERSION)
    b = dna.generate(900, seed=7, version=dna.SHORT_VERSION)
    assert [x[1] for x in a] == [x[1] for x in b]
    assert len({x[1] for x in a}) == 900 and len({x[0] for x in a}) == 900
    fams = [x[2]["family"] for x in a]
    assert all(fams.count(f) == 100 for f in dna.SHORT_FAMILIES)
    assert not {x[1] for x in a} & {x[1] for x in dna.generate(900, seed=7)}
    holds, tfs = set(), set()
    for i, h, d in a:
        assert i.startswith("NSS-") and d["v"] == dna.SHORT_VERSION
        assert dna.normalise(d) == d and dna.dna_hash(d) == h
        hold = d["exit"]["hold"]
        holds.add(hold)
        tfs.add(d["tf"])
        assert hold in (0, 1, 2, 3) and d["exit"]["time"] == 0
        if hold > 0:
            assert d["side"] == "long"
            assert d["tf"] == 1440 or d["tf"] in dna.CARRY_TF
        kinds = {f["f"] for f in d["filters"]}
        assert not {"deliv_min", "deliv_max"} <= kinds
    assert holds == {0, 1, 2, 3} and tfs == {5, 15, 30, 60, 1440}


def test_short_neighbours_stay_in_the_program():
    for _i, _h, d in dna.generate(40, seed=5, version=dna.SHORT_VERSION):
        for n in dna.neighbours(d):
            assert n["v"] == dna.SHORT_VERSION and n["exit"]["hold"] in (0, 1, 2, 3)
            assert dna.dna_hash(n) != dna.dna_hash(d)
