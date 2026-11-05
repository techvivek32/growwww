"""Point-in-time F&O membership, to take the worst of the survivorship bias out
of the alpha backtest.

Today's F&O list is a list of winners: stocks join F&O after they grow and
leave it after they shrink. Ranking stocks from today's list over 2008-2026
quietly rewards whatever predicts future growth, which a backtest then
reports as skill. The fix is to let a stock be eligible on a date only if it
had stock futures on that date.

Sources (fetched off-box, since this host cannot reach NSE):
  data/nse/fo_membership.json  {first-session date: [symbols with stock futures]}
                               one NSE F&O bhavcopy per month, 2003 onward
  data/nse/symbolchange.csv    NSE symbol changes, to map old tickers to today's
Plus the current list (instruments of kind EQ), dated when it was refreshed.

What remains: a stock that delisted (merger, failure) has no Groww history,
so it cannot be held in the backtest even when it was a member. `coverage`
reports how much of each year's membership has data.
"""

from __future__ import annotations

import csv
import datetime as dt
import json

import numpy as np

from . import config, db

DIR = config.DATA / "nse"
MEMBERSHIP = DIR / "fo_membership.json"
SYMBOL_CHANGES = DIR / "symbolchange.csv"
EPOCH = dt.date(1970, 1, 1)
# Renames missing from NSE's symbol-change file, for companies still listed.
ALIASES = {"L&T": "LT", "COLGATE": "COLPAL", "NIIT": "NIITLTD", "RUCHISOYA": "PATANJALI"}


def _parse_date(s: str) -> dt.date | None:
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            pass
    return None


def symbol_map(path=None) -> dict[str, str]:
    """old ticker -> today's ticker, following chains of renames in date order."""
    path = path or SYMBOL_CHANGES
    if not path.exists():
        return {}
    rows = []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if len(row) < 4:
                continue
            old, new, d = row[1].strip(), row[2].strip(), _parse_date(row[3])
            if old and new and old != new:
                rows.append((d or EPOCH, old, new))
    step: dict[str, str] = {}
    for _d, old, new in sorted(rows):
        step[old] = new

    def final(s: str) -> str:
        seen = set()
        while s in step and s not in seen:
            seen.add(s)
            s = step[s]
        return s

    out = {old: final(old) for old in step}
    for old, new in ALIASES.items():
        out.setdefault(old, new)
    return out


def snapshots(path=None, include_current: bool = True) -> list[tuple[int, set[str]]]:
    """[(IST day number, members under today's tickers)], oldest first."""
    path = path or MEMBERSHIP
    out: list[tuple[int, set[str]]] = []
    if path.exists():
        names = symbol_map()
        for d, syms in json.loads(path.read_text()).items():
            out.append(((dt.date.fromisoformat(d) - EPOCH).days, {names.get(s, s) for s in syms}))
    if include_current:
        with db.tx() as con:
            rows = con.execute("SELECT symbol, added_at FROM instruments WHERE kind='EQ'").fetchall()
        if rows:
            at = max(r["added_at"] for r in rows)
            day = int((at + config.IST_OFFSET_S) // 86_400)
            out.append((day, {r["symbol"] for r in rows}))
    out.sort(key=lambda x: x[0])
    return out


def members_ever(path=None) -> set[str]:
    out: set[str] = set()
    for _d, s in snapshots(path, include_current=False):
        out |= s
    return out


def mask(days: np.ndarray, symbols: list[str], snaps: list[tuple[int, set[str]]]) -> np.ndarray | None:
    """(D, S) bool: the symbol had stock futures per the latest snapshot on or
    before each day. None when there are no snapshots (no restriction)."""
    if not snaps:
        return None
    sd = np.array([d for d, _ in snaps], dtype=np.int64)
    which = np.searchsorted(sd, days, side="right") - 1
    out = np.zeros((len(days), len(symbols)), dtype=bool)
    col = {s: j for j, s in enumerate(symbols)}
    for k, (_d, members) in enumerate(snaps):
        rows = which == k
        if not rows.any():
            continue
        js = [col[s] for s in members if s in col]
        if js:
            out[np.ix_(rows, js)] = True
    return out


def coverage(days: np.ndarray, symbols: list[str], has_data: np.ndarray, snaps: list[tuple[int, set[str]]]) -> dict[str, float]:
    """Per year: share of member-days whose stock has a bar (i.e. Groww history exists)."""
    if not snaps:
        return {}
    sd = np.array([d for d, _ in snaps], dtype=np.int64)
    have = set(symbols)
    first_bar = {s: (int(days[np.argmax(has_data[:, j])]) if has_data[:, j].any() else None) for j, s in enumerate(symbols)}
    out: dict[str, list[float]] = {}
    for k, (d, members) in enumerate(snaps):
        if not members:
            continue
        nxt = sd[k + 1] if k + 1 < len(sd) else d + 31
        covered = sum(1 for s in members if s in have and first_bar[s] is not None and first_bar[s] <= nxt)
        out.setdefault(str((EPOCH + dt.timedelta(days=int(d))).year), []).append(covered / len(members))
    return {y: float(np.mean(v)) for y, v in out.items()}
