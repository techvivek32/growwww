"""Paths and fixed research settings. Everything tunable lives here so a run can
record exactly what it used."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("MNHA_RESEARCH_HOME", Path(__file__).resolve().parent.parent))
DATA = Path(os.environ.get("MNHA_RESEARCH_DATA", ROOT / "data"))
CANDLES = DATA / "candles"
CHECKPOINTS = DATA / "checkpoints"
MODELS = DATA / "models"
DB_PATH = DATA / "research.sqlite"
TOKEN_FILE = DATA / ".groww_token"

# Bar intervals researched, in minutes (1440 = daily).
INTERVALS = (5, 15, 30, 60, 1440)

# Indices pulled for the market-regime features; never traded.
REGIME_INDICES = ("NIFTY", "BANKNIFTY")

# The NIFTY 50 ETF: the benchmark a stock picker has to beat, and the regime
# series before Groww's NIFTY index history begins (2015-08). Daily only; never
# part of the strategy universe.
BENCHMARK = "NIFTYBEES"

# NSE session, IST minutes from midnight.
SESSION_OPEN = 9 * 60 + 15
SESSION_CLOSE = 15 * 60 + 30
SQUAREOFF = 15 * 60 + 15  # intraday positions are flat by the bar that ends here
LAST_ENTRY = 14 * 60 + 45  # no new intraday entry on a bar opening after this
IST_OFFSET_S = 19_800

# Position accounting.
CAPITAL_PER_TRADE = 100_000.0  # ₹ notional per position
BOOK_CAPITAL = 1_000_000.0  # ₹ book for the portfolio curve
MAX_POSITIONS = 10
SLIPPAGE_BPS = 3.0  # adverse, per market fill
SWING_MAX_HOLD = 40  # daily bars, hard cap for swing trades

# Groww's daily opens and lows before 2010 are unreliable (and the series is
# re-scaled on 2010-01-04), so the strategy pipeline trades from here and uses
# the year before only to warm indicators up. The alpha model, which uses
# closes only, reads the full history.
TRADE_FROM = "2010-01-04"
WARMUP_DAYS = 400

# Chronological split of each interval's history.
SPLIT = (0.6, 0.2, 0.2)

SEED = 20261103
TARGET_STRATEGIES = 100_000


def ensure_dirs() -> None:
    for p in (DATA, CANDLES, CHECKPOINTS, MODELS):
        p.mkdir(parents=True, exist_ok=True)
