"""End-to-end run on synthetic candles: every stage executes, writes what it
should, and keeps every strategy's record. Synthetic prices carry momentum so
some strategies get through each stage; nothing here says anything about
real markets."""

import json
import time

import numpy as np
import pandas as pd

from mnha_research import config, db, ingest, ml, pipeline, quality, ranking

from conftest import intraday_frame, resample

SYMS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]


def weekdays(start_day: int, n: int) -> list[int]:
    out, d = [], start_day
    while len(out) < n:
        if (d + 3) % 7 < 5:
            out.append(d)
        d += 1
    return out


def momentum_prices(n: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    e = rng.normal(0, 0.0025, n)
    r = np.zeros(n)
    for i in range(1, n):
        r[i] = 0.35 * r[i - 1] + e[i]
    return 500 * np.exp(np.cumsum(r))


def test_full_pipeline_on_synthetic_data(monkeypatch):
    db.migrate()
    days = weekdays(19_359, 270)  # from 2023-01-02
    now = time.time()
    for i, sym in enumerate(SYMS + ["NIFTY"]):
        n5 = 75 * len(days)
        df5 = intraday_frame(days, 5, prices=momentum_prices(n5, i), seed=i)
        for tf in config.INTERVALS:
            out = df5 if tf == 5 else resample(df5, tf)
            p = config.CANDLES / str(tf)
            p.mkdir(parents=True, exist_ok=True)
            out.to_parquet(p / f"{sym}.parquet", index=False)
        kind = "IDX" if sym == "NIFTY" else "EQ"
        with db.tx() as con:
            con.execute("INSERT OR REPLACE INTO instruments VALUES(?,?,?,?,?,?,?,?,?)", (sym, "NSE", None, sym, sym, kind, 1, "test", now))

    v = ingest.snapshot_version("synthetic test data")
    usable = quality.run(v, SYMS + ["NIFTY"])
    assert all(usable[tf] == 7 for tf in config.INTERVALS)

    monkeypatch.setattr(pipeline, "S1_MIN_TRADES", 10)
    monkeypatch.setattr(pipeline, "S1_KEEP_PER_TF", 25)
    monkeypatch.setattr(pipeline, "S2_MIN_TRADES", 10)
    monkeypatch.setattr(pipeline, "S2_KEEP_PER_TF", 10)
    gen = pipeline.generate(800, seed=1)
    assert gen["stored"] == 800

    ctx = pipeline.build_context(v)
    assert set(ctx.symbols[15]) == set(SYMS)  # the index is never traded
    s1, r1 = pipeline.step("screen", lambda rid: pipeline.screen(ctx, rid), v, ctx.params())
    with db.tx() as con:
        rows = con.execute("SELECT COUNT(*), SUM(status='advanced') FROM strategy_metrics WHERE run_id=? AND segment='train'", (s1,)).fetchone()
    assert rows[0] == 800  # every strategy keeps a record, rejected or not
    assert rows[1] > 0
    assert r1["n_trials"] == 800 and r1["sr_var"] > 0

    s2, r2 = pipeline.step("validate", lambda rid: pipeline.validate(ctx, rid, s1), v, {})
    assert r2["fdr_tested"] == rows[1]
    s3, r3 = pipeline.step("deep", lambda rid: pipeline.deep(ctx, rid, s2, s1), v, {})
    with db.tx() as con:
        n_deep = con.execute("SELECT COUNT(DISTINCT strategy_hash) FROM strategy_metrics WHERE run_id=? AND segment='trainval'", (s3,)).fetchone()[0]
        n_trades = con.execute("SELECT COUNT(*) FROM strategy_trades WHERE run_id=?", (s3,)).fetchone()[0]
        segs = {r[0] for r in con.execute("SELECT DISTINCT segment FROM strategy_trades WHERE run_id=?", (s3,))}
        tests = {r[0] for r in con.execute("SELECT DISTINCT test FROM validation_results WHERE run_id=?", (s3,))}
    assert n_deep > 0 and n_trades > 0
    assert segs == {"train", "validation", "test"}
    assert {"walk_forward", "monte_carlo", "cost_x2", "portfolio", "dsr", "stability", "by_year"} <= tests

    rk, rres = pipeline.step("rank", lambda rid: ranking.rank(rid, s3, s2), v, {})
    assert rres["ranked"] == n_deep
    with db.tx() as con:
        ranks = [r[0] for r in con.execute("SELECT rank FROM strategy_rankings WHERE run_id=? ORDER BY rank", (rk,))]
    assert ranks == list(range(1, n_deep + 1))

    ds = config.DATA / "ml" / f"run{s3}"
    frame = pd.concat([pd.read_parquet(f) for f in ds.glob("*.parquet")])
    assert set(ml.FEATURES) <= set(frame.columns)
    try:
        res = ml.train(s3, ds)
        assert res["rows"]["train"] > 0 and "auc" in res
    except RuntimeError as e:
        assert "not enough trades" in str(e)

    # A second call on a finished chunk set is a no-op resume, not a duplicate.
    with db.tx() as con:
        before = con.execute("SELECT COUNT(*) FROM strategy_trades WHERE run_id=?", (s3,)).fetchone()[0]
    pipeline.deep(ctx, s3, s2, s1)
    with db.tx() as con:
        after = con.execute("SELECT COUNT(*) FROM strategy_trades WHERE run_id=?", (s3,)).fetchone()[0]
    assert before == after
    json.dumps(r3)

    # ---- the short-hold program on the same data: its own definitions and runs
    sp = pipeline.SHORT
    g2 = pipeline.generate(450, seed=2, prog=sp)
    assert g2["stored"] == 450
    with db.tx() as con:
        assert con.execute("SELECT COUNT(*) FROM strategy_definitions WHERE version=1").fetchone()[0] == 800
    q1, _ = pipeline.step(sp.kind("screen"), lambda rid: pipeline.screen(ctx, rid, sp), v, {})
    q2, _ = pipeline.step(sp.kind("validate"), lambda rid: pipeline.validate(ctx, rid, q1, sp), v, {})
    q3, _ = pipeline.step(sp.kind("deep"), lambda rid: pipeline.deep(ctx, rid, q2, q1, sp), v, {})
    pipeline.step(sp.kind("rank"), lambda rid: ranking.rank(rid, q3, q2), v, {})
    with db.tx() as con:
        assert con.execute("SELECT COUNT(*) FROM strategy_metrics WHERE run_id=? AND segment='train'", (q1,)).fetchone()[0] == 450
        tr = con.execute("SELECT entry_time, exit_time, side FROM strategy_trades WHERE run_id=?", (q3,)).fetchall()
        port = [json.loads(r[0]) for r in con.execute("SELECT value FROM validation_results WHERE run_id=? AND test='portfolio'", (q3,))]
    assert tr and port and all(x["book"] == 500_000.0 and x["max_positions"] == 5 for x in port)
    pos = {d: i for i, d in enumerate(days)}
    for et, xt, side in tr:
        held = pos[(xt // 1000 + 19_800) // 86_400] - pos[(et // 1000 + 19_800) // 86_400]
        assert 0 <= held <= 3
        assert held == 0 or side == 1  # nothing short overnight
