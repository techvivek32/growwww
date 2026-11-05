"""SQLite store for everything except candles (which live in Parquet).

SQLite rather than Postgres on purpose: the research box has one vCPU and
4 GB, the pipeline is the only writer, and a server process would take memory
the backtests need. The schema is plain SQL and ports to Postgres unchanged.

Nothing here is ever overwritten: every run gets its own id, and metrics,
trades and rankings are keyed by run.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import time
from contextlib import contextmanager
from typing import Any, Iterable, Iterator

from . import config

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS instruments (
  symbol TEXT PRIMARY KEY, exchange TEXT NOT NULL, isin TEXT, name TEXT,
  groww_symbol TEXT, kind TEXT NOT NULL, fno INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL, added_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_state (
  symbol TEXT NOT NULL, interval INTEGER NOT NULL,
  first_time INTEGER, last_time INTEGER, rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, error TEXT, updated_at REAL NOT NULL,
  PRIMARY KEY (symbol, interval)
);

CREATE TABLE IF NOT EXISTS probes (
  interval INTEGER PRIMARY KEY, symbol TEXT NOT NULL, earliest_time INTEGER,
  detail TEXT, probed_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS data_versions (
  id TEXT PRIMARY KEY, created_at REAL NOT NULL, manifest TEXT NOT NULL, notes TEXT
);

CREATE TABLE IF NOT EXISTS data_quality (
  data_version TEXT NOT NULL, symbol TEXT NOT NULL, interval INTEGER NOT NULL,
  rows INTEGER NOT NULL, sessions INTEGER NOT NULL, completeness REAL,
  bad_ohlc INTEGER NOT NULL, zero_volume INTEGER NOT NULL, off_session INTEGER NOT NULL,
  breaks TEXT NOT NULL, usable INTEGER NOT NULL, reason TEXT,
  PRIMARY KEY (data_version, symbol, interval)
);

CREATE TABLE IF NOT EXISTS strategy_definitions (
  hash TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, family TEXT NOT NULL,
  tf INTEGER NOT NULL, dna TEXT NOT NULL, version INTEGER NOT NULL, created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sd_family ON strategy_definitions(family, tf);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, status TEXT NOT NULL,
  started_at REAL NOT NULL, finished_at REAL, data_version TEXT, code_version TEXT,
  params TEXT NOT NULL, seed INTEGER, progress TEXT, error TEXT, summary TEXT
);

CREATE TABLE IF NOT EXISTS run_chunks (
  run_id INTEGER NOT NULL, chunk TEXT NOT NULL, finished_at REAL NOT NULL,
  PRIMARY KEY (run_id, chunk)
);

CREATE TABLE IF NOT EXISTS strategy_metrics (
  run_id INTEGER NOT NULL, strategy_hash TEXT NOT NULL, segment TEXT NOT NULL,
  trades INTEGER NOT NULL, wins INTEGER NOT NULL, gross_profit REAL NOT NULL,
  gross_loss REAL NOT NULL, costs REAL NOT NULL, net_pnl REAL NOT NULL,
  profit_factor REAL, win_rate REAL, expectancy REAL, sharpe REAL, t_stat REAL,
  max_dd REAL, avg_hold_bars REAL, symbols INTEGER, status TEXT NOT NULL, reason TEXT,
  PRIMARY KEY (run_id, strategy_hash, segment)
);
CREATE INDEX IF NOT EXISTS ix_sm_status ON strategy_metrics(run_id, segment, status);

CREATE TABLE IF NOT EXISTS strategy_trades (
  run_id INTEGER NOT NULL, strategy_hash TEXT NOT NULL, symbol TEXT NOT NULL,
  segment TEXT NOT NULL, side INTEGER NOT NULL, entry_time INTEGER NOT NULL,
  exit_time INTEGER NOT NULL, entry_px REAL NOT NULL, exit_px REAL NOT NULL,
  qty INTEGER NOT NULL, gross REAL NOT NULL, costs REAL NOT NULL, net REAL NOT NULL,
  bars INTEGER NOT NULL, reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_st ON strategy_trades(run_id, strategy_hash);

CREATE TABLE IF NOT EXISTS validation_results (
  run_id INTEGER NOT NULL, strategy_hash TEXT NOT NULL, test TEXT NOT NULL,
  value TEXT NOT NULL, PRIMARY KEY (run_id, strategy_hash, test)
);

CREATE TABLE IF NOT EXISTS strategy_rankings (
  run_id INTEGER NOT NULL, strategy_hash TEXT NOT NULL, rank INTEGER,
  score REAL, eligible INTEGER NOT NULL, status TEXT NOT NULL,
  gates TEXT NOT NULL, components TEXT NOT NULL,
  PRIMARY KEY (run_id, strategy_hash)
);

CREATE TABLE IF NOT EXISTS ml_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, created_at REAL NOT NULL,
  kind TEXT NOT NULL, features TEXT NOT NULL, params TEXT NOT NULL,
  metrics TEXT NOT NULL, artifact TEXT NOT NULL
);

-- Paper trading: a book freezes one alpha model; picks are written with the
-- time they were published and are never updated.
CREATE TABLE IF NOT EXISTS paper_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT, variant TEXT NOT NULL, created_at REAL NOT NULL,
  model_id INTEGER NOT NULL, artifact TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS paper_picks (
  book_id INTEGER NOT NULL, asof_day INTEGER NOT NULL, created_at REAL NOT NULL,
  rank INTEGER NOT NULL, symbol TEXT NOT NULL, score REAL NOT NULL,
  PRIMARY KEY (book_id, asof_day, symbol)
);
CREATE TABLE IF NOT EXISTS paper_marks (
  book_id INTEGER NOT NULL, asof_day INTEGER NOT NULL, marked_at REAL NOT NULL, summary TEXT NOT NULL,
  PRIMARY KEY (book_id, asof_day)
);
"""


def connect() -> sqlite3.Connection:
    config.ensure_dirs()
    con = sqlite3.connect(config.DB_PATH, timeout=60)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def migrate() -> None:
    with tx() as con:
        con.executescript(SCHEMA)
        con.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(SCHEMA_VERSION),),
        )


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    con = connect()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def code_version() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=config.ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        stamp = config.ROOT / "CODE_VERSION"
        return stamp.read_text().strip() if stamp.exists() else "unknown"


def start_run(kind: str, params: dict[str, Any], data_version: str | None, seed: int | None = None) -> int:
    with tx() as con:
        cur = con.execute(
            "INSERT INTO runs(kind, status, started_at, data_version, code_version, params, seed) VALUES(?,?,?,?,?,?,?)",
            (kind, "running", time.time(), data_version, code_version(), json.dumps(params, sort_keys=True), seed),
        )
        return int(cur.lastrowid)


def progress(run_id: int, info: dict[str, Any]) -> None:
    with tx() as con:
        con.execute("UPDATE runs SET progress=? WHERE id=?", (json.dumps(info), run_id))


def finish_run(run_id: int, status: str, summary: dict[str, Any] | None = None, error: str | None = None) -> None:
    with tx() as con:
        con.execute(
            "UPDATE runs SET status=?, finished_at=?, summary=?, error=? WHERE id=?",
            (status, time.time(), json.dumps(summary or {}), error, run_id),
        )


def chunk_done(run_id: int, chunk: str) -> None:
    with tx() as con:
        con.execute("INSERT OR REPLACE INTO run_chunks(run_id, chunk, finished_at) VALUES(?,?,?)", (run_id, chunk, time.time()))


def chunks_finished(run_id: int) -> set[str]:
    with tx() as con:
        return {r[0] for r in con.execute("SELECT chunk FROM run_chunks WHERE run_id=?", (run_id,))}


def latest_run(kind: str, status: str | None = "done") -> sqlite3.Row | None:
    with tx() as con:
        if status:
            return con.execute("SELECT * FROM runs WHERE kind=? AND status=? ORDER BY id DESC LIMIT 1", (kind, status)).fetchone()
        return con.execute("SELECT * FROM runs WHERE kind=? ORDER BY id DESC LIMIT 1", (kind,)).fetchone()


def executemany(sql: str, rows: Iterable[tuple]) -> None:
    with tx() as con:
        con.executemany(sql, rows)
