"""Read-only research API for the dashboard. Binds to localhost by default. With
MNHA_API_HOST=0.0.0.0 and MNHA_API_TOKEN set, the paper-trading summary at /live
is served to the Vercel app (bearer token; everything else stays local-only).
Nothing here can place an order or change a strategy."""

from __future__ import annotations

import json
import os
import secrets
import time

from fastapi import Body, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from . import db

app = FastAPI(title="MNHA research", version="0.1.0")


@app.middleware("http")
async def _local_only(request: Request, call_next):
    """Everything except /health and /live is for localhost (the SSH tunnel), whatever the bind address."""
    host = request.client.host if request.client else ""
    if request.url.path not in ("/health", "/live", "/live/today", "/live/ticks") and host not in ("127.0.0.1", "::1"):
        return JSONResponse({"detail": "local only"}, status_code=403)
    return await call_next(request)


def _authorised(authorization: str | None) -> None:
    token = os.environ.get("MNHA_API_TOKEN", "")
    if not token:
        raise HTTPException(503, "MNHA_API_TOKEN is not set on the research box")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not given or not secrets.compare_digest(given, token):
        raise HTTPException(401, "bad token")


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


TRADE_DAYS = 180  # sessions of legs served to the dashboard; it reports anything older as not served


def _first_served_day(con, table: str) -> int | None:
    r = con.execute(f"SELECT MIN(day) FROM (SELECT DISTINCT day FROM {table} ORDER BY day DESC LIMIT ?)", (TRADE_DAYS,)).fetchone()
    return int(r[0]) if r and r[0] is not None else None


@app.get("/live")
def live_summary(authorization: str | None = Header(default=None)) -> dict:
    """Live PAPER trading for the dashboard: the 2026 strategy (livex) and the reference books (live)."""
    _authorised(authorization)
    from . import live, livex

    out: dict = {"as_of": time.time(), "book": livex.BOOK, "livex": None, "live": None}
    try:
        out["livex"] = livex.report()
        with db.tx() as con:
            r = con.execute("SELECT * FROM livex_days WHERE day=?", (live.today_ist(),)).fetchone()
            out["livex"]["today"] = dict(r) if r else None
            # Every leg of the latest TRADE_DAYS sessions. Cut by DAY, never by leg count: half a
            # day's legs would make the dashboard's day total a number no session ever produced.
            out["livex"]["trades_from"] = first = _first_served_day(con, "livex_trades")
            out["livex"]["trades"] = [dict(x) for x in con.execute(
                "SELECT * FROM livex_trades WHERE day >= ? ORDER BY day DESC, leg", (first or 0,))]
            out["livex"]["days_all"] = [dict(x) for x in con.execute(
                "SELECT day, status, skip, pick, pick_px, pick_ltp, flip, flip_symbol, flip_px, decided_at, settled_at FROM livex_days ORDER BY day")]
    except Exception as e:  # noqa: BLE001  (tables absent before the first session)
        out["livex_error"] = str(e)[:200]
    try:
        from . import livex_session

        out["sl05"] = livex_session.report_sl05()
        with db.tx() as con:
            out["sl05"]["today"] = [dict(x) for x in con.execute("SELECT * FROM livex_fast WHERE day=? AND book='sl05'", (live.today_ist(),))]
    except Exception as e:  # noqa: BLE001
        out["sl05_error"] = str(e)[:200]
    try:  # manual paper trades the user asked for (outside the tested rule), marked at the live price when open
        import json as _json
        from . import config

        p = config.DATA / "manual_trades.json"
        manual = _json.loads(p.read_text()) if p.exists() else []
        open_syms = sorted({m["symbol"] for m in manual if m.get("status") == "open"})
        quotes = live.ltp(open_syms)[0] if open_syms else {}
        for m in manual:
            if m.get("status") == "open" and m["symbol"] in quotes:
                ltp = quotes[m["symbol"]]
                m["ltp"] = ltp
                m["running_pnl"] = round((m["entry"] - ltp) * m["qty"] if m["side"] == "short" else (ltp - m["entry"]) * m["qty"], 2)
        out["manual"] = manual
    except Exception as e:  # noqa: BLE001
        out["manual_error"] = str(e)[:200]
    try:
        out["live"] = live.report()
    except Exception as e:  # noqa: BLE001
        out["live_error"] = str(e)[:200]
    return out


@app.get("/live/today")
def live_today(authorization: str | None = Header(default=None)) -> dict:
    """Today's book A decisions (09:20 pick, 10:15 flip, market stop) for the website's live-trading executor.
    Local only (the middleware), with the same bearer token as /live."""
    _authorised(authorization)
    from . import livex

    return livex.today_state()


@app.get("/live/ticks")
def live_ticks(authorization: str | None = Header(default=None)) -> dict:
    """Open paper positions at the live price, for the dashboard's per-second strip (one LTP call, no writes)."""
    _authorised(authorization)
    from . import livex

    return livex.ticks()


@app.post("/live/book-a/admin")
def book_a_admin(body: dict = Body(...), authorization: str | None = Header(default=None)) -> dict:
    """The admin's hand on Book A's open short: {"mode": "cover"} covers it now, {"mode": "reverse"} covers and goes
    long the same stock to 15:15. Paper only; recorded as an event and priced at settle. Local only."""
    _authorised(authorization)
    from . import livex

    try:
        mode = str(body.get("mode") or "reverse")
        fn = {"close-long": livex.admin_close_long, "reshort": livex.admin_reshort, "close-reshort": livex.admin_close_reshort}.get(mode)
        return {"ok": True, "result": fn() if fn else livex.admin_reverse(mode)}
    except RuntimeError as e:
        raise HTTPException(400, str(e))


@app.post("/live/manual/exit")
def manual_exit(body: dict = Body(...), authorization: str | None = Header(default=None)) -> dict:
    """Close an open manual paper trade at the live price (the admin's Exit button). Local only; paper only."""
    _authorised(authorization)
    from . import manual

    try:
        return {"ok": True, "trade": manual.close_trade(str(body.get("symbol", "")), str(body.get("why") or "admin exit"), body.get("entry_time"))}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/live/manual/open")
def manual_open(body: dict = Body(...), authorization: str | None = Header(default=None)) -> dict:
    """Open a manual paper trade at the live price (₹5 lakh, 1% stop by default). Local only; paper only."""
    _authorised(authorization)
    from . import manual

    try:
        return {"ok": True, "trade": manual.open_trade(str(body.get("symbol", "")), str(body.get("side", "short")), str(body.get("note") or ""),
                                                       float(body.get("stop_pct") or 0.01))}
    except ValueError as e:
        raise HTTPException(400, str(e))


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
