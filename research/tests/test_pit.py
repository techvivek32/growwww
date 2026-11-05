import json

import numpy as np

from mnha_research import pit


def test_symbol_changes_follow_chains(tmp_path):
    f = tmp_path / "symbolchange.csv"
    f.write_text("NAME OF THE COMPANY,OLD SYMBOL,NEW SYMBOL,EFFECTIVE DATE\n"
                 " Infosys,INFOSYSTCH,INFY,30-JUN-2011\n"
                 " A Ltd,AAA,BBB,01-JAN-2012\n"
                 " A Ltd,BBB,CCC,01-JAN-2015\n")
    m = pit.symbol_map(f)
    assert m["INFOSYSTCH"] == "INFY"
    assert m["AAA"] == "CCC" and m["BBB"] == "CCC"


def test_mask_uses_only_snapshots_already_published():
    snaps = [(100, {"A"}), (130, {"A", "B"}), (160, {"B"})]
    days = np.array([90, 100, 129, 130, 159, 160, 200])
    m = pit.mask(days, ["A", "B", "C"], snaps)
    assert m[:, 0].tolist() == [False, True, True, True, True, False, False]
    assert m[:, 1].tolist() == [False, False, False, True, True, True, True]
    assert not m[:, 2].any()
    assert pit.mask(days, ["A"], []) is None


def test_snapshots_map_old_tickers(tmp_path, monkeypatch):
    (tmp_path / "symbolchange.csv").write_text("N,OLD SYMBOL,NEW SYMBOL,D\n x,INFOSYSTCH,INFY,30-JUN-2011\n")
    mem = tmp_path / "fo.json"
    mem.write_text(json.dumps({"2010-01-04": ["INFOSYSTCH", "SBIN"]}))
    monkeypatch.setattr(pit, "SYMBOL_CHANGES", tmp_path / "symbolchange.csv")
    snaps = pit.snapshots(mem, include_current=False)
    assert snaps[0][1] == {"INFY", "SBIN"}
