"""Read-only research API for the dashboard. Binds to localhost; the Next.js
server reaches it over an SSH tunnel or a firewall rule, never the open web.
Nothing here can place an order or change a strategy."""

from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException, Query

from . import db

app = FastAPI(title="MNHA research", version="0.1.0")


def _rows(sql: str, params: tuple = ()) -> list[dict]:
    with db.tx() as con:
        return [dict(r) for r in con.execute(sql, params)]


def _latest(kind: str) -> int | None:
    r = db.latest_run(kind)
    return int(r["id"]) if r else None


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/status")
def status() -> dict:
    with db.tx() as con:
        generated = con.execute("SELECT COUNT(*) FROM strategy_definitions").fetchone()[0]
        runs = [dict(r) for r in con.execute(
            "SELECT id, kind, status, started_at, finished_at, data_version, code_version, progress, error FROM runs ORDER BY id DESC LIMIT 20")]
    out = {"strategies_generated": generated, "runs": runs}
    s1 = _latest("screen")
    if s1:
        out["backtested_stage1"] = _rows("SELECT COUNT(*) n FROM strategy_metrics WHERE run_id=? AND segment='train'", (s1,))[0]["n"]
    rk = _latest("rank")
    if rk:
        out["ranking"] = _rows("SELECT status, COUNT(*) n FROM strategy_rankings WHERE run_id=? GROUP BY status", (rk,))
    return out


@app.get("/rankings")
def rankings(limit: int = Query(100, le=1000), status: str | None = None, program: str = "main") -> list[dict]:
    rk = _latest("rank" if program == "main" else f"{program}_rank")
    if not rk:
        return []
    sql = ("SELECT r.rank, r.score, r.eligible, r.status, r.gates, r.components, d.id, d.family, d.tf, d.dna "
           "FROM strategy_rankings r JOIN strategy_definitions d ON d.hash = r.strategy_hash WHERE r.run_id=?")
    params: tuple = (rk,)
    if status:
        sql += " AND r.status=?"
        params += (status,)
    rows = _rows(sql + " ORDER BY r.rank LIMIT ?", params + (limit,))
    for r in rows:
        for k in ("gates", "components", "dna"):
            r[k] = json.loads(r[k])
    return rows


@app.get("/strategies/{sid}")
def strategy(sid: str) -> dict:
    d = _rows("SELECT * FROM strategy_definitions WHERE id=? OR hash=?", (sid, sid))
    if not d:
        raise HTTPException(404, "unknown strategy")
    d = d[0]
    d["dna"] = json.loads(d["dna"])
    h = d["hash"]
    d["metrics"] = _rows("SELECT m.*, ru.kind FROM strategy_metrics m JOIN runs ru ON ru.id = m.run_id WHERE strategy_hash=? ORDER BY run_id", (h,))
    d["validation"] = {r["test"]: json.loads(r["value"]) for r in _rows(
        "SELECT test, value FROM validation_results WHERE strategy_hash=? ORDER BY run_id", (h,))}
    d["ranking"] = _rows("SELECT * FROM strategy_rankings WHERE strategy_hash=? ORDER BY run_id DESC LIMIT 1", (h,))
    return d


@app.get("/strategies/{sid}/trades")
def trades(sid: str, segment: str | None = None, limit: int = Query(2000, le=20000)) -> list[dict]:
    d = _rows("SELECT hash FROM strategy_definitions WHERE id=? OR hash=?", (sid, sid))
    if not d:
        raise HTTPException(404, "unknown strategy")
    deep = _latest("deep")
    sql = "SELECT * FROM strategy_trades WHERE run_id=? AND strategy_hash=?"
    params: tuple = (deep, d[0]["hash"])
    if segment:
        sql += " AND segment=?"
        params += (segment,)
    return _rows(sql + " ORDER BY entry_time LIMIT ?", params + (limit,))


@app.get("/runs/{rid}")
def run(rid: int) -> dict:
    r = _rows("SELECT * FROM runs WHERE id=?", (rid,))
    if not r:
        raise HTTPException(404, "unknown run")
    r = r[0]
    for k in ("params", "summary", "progress"):
        if r.get(k):
            r[k] = json.loads(r[k])
    return r


@app.get("/models")
def models() -> list[dict]:
    rows = _rows("SELECT id, run_id, created_at, kind, metrics, artifact FROM ml_models ORDER BY id DESC")
    for r in rows:
        r["metrics"] = json.loads(r["metrics"])
    return rows


@app.get("/data/quality")
def data_quality() -> list[dict]:
    with db.tx() as con:
        v = con.execute("SELECT id FROM data_versions ORDER BY created_at DESC LIMIT 1").fetchone()
    if not v:
        return []
    return _rows("SELECT * FROM data_quality WHERE data_version=? ORDER BY usable, symbol, interval", (v[0],))


@app.get("/alpha")
def alpha_latest() -> dict:
    rid = _latest("alpha")
    if not rid:
        return {}
    return run(rid)


@app.get("/paper")
def paper_books() -> list[dict]:
    books = _rows("SELECT * FROM paper_books ORDER BY id")
    for b in books:
        m = _rows("SELECT summary FROM paper_marks WHERE book_id=? ORDER BY asof_day DESC LIMIT 1", (b["id"],))
        b["mark"] = json.loads(m[0]["summary"]) if m else None
        b["latest_picks"] = _rows(
            "SELECT asof_day, created_at, rank, symbol, score FROM paper_picks WHERE book_id=? AND asof_day=(SELECT MAX(asof_day) FROM paper_picks WHERE book_id=?) ORDER BY rank",
            (b["id"], b["id"]))
    return books
