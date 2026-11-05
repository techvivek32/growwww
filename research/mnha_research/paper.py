"""Paper trading — the forward test that decides whether the model is real.

A book freezes one trained alpha model (a copy of its artifact). After each
week's last session is in the data, `publish` scores the universe with that
frozen model and stores the ranked list with the time it was written.
`mark` replays only those stored lists through the same simulator as the
backtest, executing each at the first session close AFTER it was published,
so nothing can be picked with hindsight and the model can never be refitted
to the period it is judged on. No order is sent anywhere.
"""

from __future__ import annotations

import json
import shutil
import time

import joblib
import numpy as np
import pandas as pd

from . import alpha, config, db
from .validation import day_to_date

FRIDAY = 4


def _weekday(day: int) -> int:
    return int((day + 3) % 7)  # 0 = Monday (day 0 = Thursday 1970-01-01)


def _now_ist(now: float) -> tuple[int, int]:
    t = int(now) + config.IST_OFFSET_S
    return t // 86_400, (t % 86_400) // 60


def start(variants: list[str] | None = None) -> list[dict]:
    """Open one book per variant from the latest alpha models, unless one is active."""
    out = []
    with db.tx() as con:
        for variant in variants or list(alpha.VARIANTS):
            have = con.execute("SELECT id FROM paper_books WHERE variant=? AND active=1", (variant,)).fetchone()
            if have:
                out.append({"variant": variant, "book": have[0], "new": False})
                continue
            m = con.execute("SELECT id, artifact FROM ml_models WHERE kind=? ORDER BY id DESC LIMIT 1", (f"alpha_{variant}",)).fetchone()
            if not m:
                raise RuntimeError(f"no alpha_{variant} model — run `alpha` first")
            cur = con.execute("INSERT INTO paper_books(variant, created_at, model_id, artifact) VALUES(?,?,?,?)",
                              (variant, time.time(), m["id"], ""))
            book = cur.lastrowid
            frozen = config.MODELS / f"paper_book{book}_{variant}.joblib"
            shutil.copyfile(m["artifact"], frozen)
            con.execute("UPDATE paper_books SET artifact=? WHERE id=?", (str(frozen), book))
            out.append({"variant": variant, "book": book, "new": True, "model_id": m["id"]})
    return out


def _books() -> list[dict]:
    with db.tx() as con:
        return [dict(r) for r in con.execute("SELECT * FROM paper_books WHERE active=1 ORDER BY id")]


def publish(now: float | None = None, des: alpha.Design | None = None) -> list[dict]:
    """Store this week's ranked list for every active book, once the week's
    last session is in: the latest bar is a Friday whose close has passed, or
    a Thursday/Friday seen from a later week (a Friday holiday)."""
    now = time.time() if now is None else now
    if des is None:
        des, _ = alpha.load_design()
    days = des.p.days
    asof = int(days[-1])
    today, minute = _now_ist(now)
    week_over = (today + 3) // 7 > (asof + 3) // 7
    ready = (_weekday(asof) == FRIDAY and (today > asof or minute >= config.SESSION_CLOSE)) or (week_over and _weekday(asof) >= 3 and today - asof <= 4)
    out = []
    for b in _books():
        with db.tx() as con:
            done = con.execute("SELECT 1 FROM paper_picks WHERE book_id=? AND asof_day=? LIMIT 1", (b["id"], asof)).fetchone()
            first = con.execute("SELECT MIN(asof_day) FROM paper_picks WHERE book_id=?", (b["id"],)).fetchone()[0]
        h = alpha.VARIANTS[b["variant"]]
        due = ready and not done and (first is None or ((asof + 3) // 7 - (first + 3) // 7) % h == 0)
        if not due:
            out.append({"book": b["id"], "variant": b["variant"], "asof": day_to_date(asof).isoformat(), "published": False,
                        "reason": "already published" if done else ("week not finished" if not ready else "not a rebalance week")})
            continue
        art = joblib.load(b["artifact"])
        picks = alpha.current_picks(art["model"], des, len(days) - 1, alpha.BUFFER)
        with db.tx() as con:
            con.executemany("INSERT INTO paper_picks(book_id, asof_day, created_at, rank, symbol, score) VALUES(?,?,?,?,?,?)",
                            [(b["id"], asof, now, x["rank"], x["symbol"], x["score"]) for x in picks])
        out.append({"book": b["id"], "variant": b["variant"], "asof": day_to_date(asof).isoformat(), "published": True,
                    "top": [x["symbol"] for x in picks[: alpha.TOP_K]]})
    return out


def _events(des: alpha.Design, rows: list[dict]) -> tuple[list[tuple[int, np.ndarray]], list[dict]]:
    """Stored lists -> simulator events, each at the first session close after publication."""
    days = des.p.days
    idx = {s: j for j, s in enumerate(des.p.symbols)}
    close_ts = (days * 86_400 + config.SESSION_CLOSE * 60 - config.IST_OFFSET_S).astype(np.int64)
    by_day: dict[int, list[dict]] = {}
    for r in rows:
        by_day.setdefault(r["asof_day"], []).append(r)
    events, pending = [], []
    for asof, picks in sorted(by_day.items()):
        created = max(p["created_at"] for p in picks)
        cand = np.nonzero((days > asof) & (close_ts > created))[0]
        if not len(cand):
            pending.append({"asof": day_to_date(asof).isoformat(), "top": [p["symbol"] for p in sorted(picks, key=lambda p: p["rank"])][: alpha.TOP_K]})
            continue
        sc = np.full(len(des.p.symbols), np.nan)
        for p in picks:
            if p["symbol"] in idx:
                sc[idx[p["symbol"]]] = -float(p["rank"])
        events.append((int(cand[0]), sc))
    return events, pending


def mark(des: alpha.Design | None = None) -> list[dict]:
    if des is None:
        des, _ = alpha.load_design()
    days = des.p.days
    out = []
    for b in _books():
        with db.tx() as con:
            rows = [dict(r) for r in con.execute("SELECT * FROM paper_picks WHERE book_id=? ORDER BY asof_day, rank", (b["id"],))]
        events, pending = _events(des, rows)
        s: dict = {"book": b["id"], "variant": b["variant"], "model_id": b["model_id"], "lists_published": len({r["asof_day"] for r in rows}),
                   "pending": pending, "data_through": day_to_date(int(days[-1])).isoformat()}
        if events:
            sim = alpha.simulate(des, events)
            st = sim["start_row"]
            eq = sim["equity"]
            bench = pd.Series(des.p.bench_c).ffill().to_numpy()
            b0 = bench[st]
            s.update({
                "started": day_to_date(int(days[st])).isoformat(), "sessions": int(len(days) - st),
                "equity": float(eq[-1]), "return": float(eq[-1] / alpha.BOOK - 1),
                "niftybees_return": float(bench[-1] / b0 - 1) if np.isfinite(b0) else None,
                "max_dd": float(np.max(1 - eq[st:] / np.maximum.accumulate(eq[st:]))),
                "open_positions": sim["open"], "closed_trades": len([t for t in sim["trades"] if t["why"] != "end"]),
                "costs": sim["costs"],
                "curve": [[day_to_date(int(days[r])).isoformat(), float(eq[r])] for r in range(st, len(days))],
            })
        with db.tx() as con:
            con.execute("INSERT OR REPLACE INTO paper_marks(book_id, asof_day, marked_at, summary) VALUES(?,?,?,?)",
                        (b["id"], int(days[-1]), time.time(), json.dumps(s, default=str)))
        out.append({k: v for k, v in s.items() if k != "curve"})
    return out


def daily() -> dict:
    """The after-close job: refresh daily bars, publish if the week is done, mark."""
    from . import ingest

    res = ingest.ingest(intervals=(1440,), respect_hours=True)
    des, _ = alpha.load_design()
    return {"ingest": res, "publish": publish(des=des), "mark": mark(des)}
