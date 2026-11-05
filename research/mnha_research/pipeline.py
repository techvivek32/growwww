"""The staged research pipeline.

  generate   100,000 unique strategy DNAs                       (strategy_definitions)
  screen     every DNA on the TRAIN period of a liquid subset   (stage 1, all metrics kept)
  validate   stage-1 survivors on the full universe, TRAIN and VALIDATION
             periods; FDR, PBO and the walk-forward selection test   (stage 2)
  deep       stage-2 survivors: every trade stored, walk-forward folds,
             Monte Carlo, cost x2, parameter neighbours, regimes, portfolio
             curve, deflated Sharpe; the TEST period is evaluated once here
             and only reported — nothing upstream ever selects on it (stage 3)
  rank       gates + weighted score                             (strategy_rankings)
  train      meta-label model                                   (ml_models)

Two programs share these stages: MAIN (the 100,000, swing holds up to 40
days) and SHORT (5,000, cash equity held at most 3 sessions, a ₹5 lakh book
of 5 positions). Each keeps its own definitions (DNA version) and run kinds.

Entries are allowed only on days the stock was in the F&O list (pit.py), and
the daily universe includes former members, so neither program trades
today's winners with hindsight.

Every step is a run with its own id, data version and code version; each
(stage, interval, symbol) chunk is checkpointed, so a crash resumes.
Rejected strategies keep their metrics and the reason — nothing is dropped
silently.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import config, db, dna as dnamod, engine, ingest, ml, pit, quality, rules, validation
from .costs import describe as cost_model
from .metrics import AggTable, summary
from .series import Cache, Series, cut, load_frame

S1_SCREEN_SYMBOLS = 40
S1_MIN_TRADES, S1_MIN_PF, S1_KEEP_PER_TF = 30, 1.05, 800
S2_MIN_TRADES, S2_MIN_PF, S2_KEEP_PER_TF = 30, 1.05, 100
WF_FOLDS = 6
MAX_NEIGHBOURS = 8
MIN_PIECE_BARS = 120
ML_ROWS_PER_STRATEGY = 4000
TRADE_SQL = ("INSERT INTO strategy_trades(run_id, strategy_hash, symbol, segment, side, entry_time, exit_time, entry_px, exit_px, qty, "
             "gross, costs, net, bars, reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")

log = ingest.log
DELIVERY = config.DATA / "nse" / "delivery.parquet"


@dataclass(frozen=True)
class Program:
    name: str
    dna_version: int
    total: int
    seed: int
    book: float  # ₹ the portfolio curve starts from
    max_pos: int  # positions open at once, each config.CAPITAL_PER_TRADE

    def kind(self, stage: str) -> str:
        return stage if self.name == "main" else f"{self.name}_{stage}"


MAIN = Program("main", dnamod.VERSION, config.TARGET_STRATEGIES, config.SEED, config.BOOK_CAPITAL, config.MAX_POSITIONS)
SHORT = Program("short", dnamod.SHORT_VERSION, 5_000, config.SEED + 2, 500_000.0, 5)
PROGRAMS = {p.name: p for p in (MAIN, SHORT)}


# ------------------------------------------------------------ context
@dataclass
class Context:
    data_version: str
    symbols: dict[int, list[str]]
    days: dict[int, np.ndarray]
    bounds: dict[int, tuple[int, int]]
    screen: dict[int, list[str]]
    breaks: dict[str, list[int]]
    sym_id: dict[str, int] = field(default_factory=dict)
    nifty: ml.Nifty | None = None
    # symbol -> (snapshot days, member at each snapshot); empty = no restriction
    membership: dict[str, tuple[np.ndarray, np.ndarray]] = field(default_factory=dict)
    pit_snapshots: int = 0
    delivery: dict[str, tuple[np.ndarray, np.ndarray]] = field(default_factory=dict)

    def member(self, symbol: str, days: np.ndarray) -> np.ndarray | None:
        if not self.pit_snapshots:
            return None
        m = self.membership.get(symbol)
        if m is None:
            return np.zeros(len(days), dtype=bool)
        sd, inn = m
        idx = np.searchsorted(sd, days, side="right") - 1
        out = np.zeros(len(days), dtype=bool)
        ok = idx >= 0
        out[ok] = inn[idx[ok]]
        return out

    def params(self) -> dict:
        return {
            "data_version": self.data_version,
            "bounds": {str(k): [validation.day_to_date(a).isoformat(), validation.day_to_date(b).isoformat()] for k, (a, b) in self.bounds.items()},
            "first_day": {str(k): validation.day_to_date(int(v[0])).isoformat() for k, v in self.days.items() if len(v)},
            "last_day": {str(k): validation.day_to_date(int(v[-1])).isoformat() for k, v in self.days.items() if len(v)},
            "symbols": {str(k): len(v) for k, v in self.symbols.items()},
            "screen_symbols": {str(k): v for k, v in self.screen.items()},
            "costs": cost_model(),
            "split": config.SPLIT,
            "pit_snapshots": self.pit_snapshots,
            "delivery_symbols": len(self.delivery),
        }


def _membership() -> tuple[dict[str, tuple[np.ndarray, np.ndarray]], int]:
    """Point-in-time F&O membership per symbol. Without the NSE membership
    file there is no restriction (and the daily universe is today's list)."""
    if not pit.MEMBERSHIP.exists():
        return {}, 0
    snaps = pit.snapshots()
    sd = np.array([d for d, _ in snaps], dtype=np.int64)
    every = set().union(*(m for _, m in snaps))
    return {s: (sd, np.array([s in m for _, m in snaps], dtype=bool)) for s in every}, len(snaps)


def _delivery() -> dict[str, tuple[np.ndarray, np.ndarray]]:
    if not DELIVERY.exists():
        return {}
    df = pd.read_parquet(DELIVERY).sort_values(["symbol", "day"])
    out = {}
    for sym, g in df.groupby("symbol", sort=False):
        out[str(sym)] = (g["day"].to_numpy(dtype=np.int64), g["share"].to_numpy(dtype=np.float64))
    return out


def build_context(data_version: str) -> Context:
    membership, n_snaps = _membership()
    # former F&O members have daily history only; with point-in-time gating
    # they belong in the daily universe for the years they were members
    eq = set(ingest.stocks() if n_snaps else ingest.universe(include_indices=False))
    symbols, days, bounds, screen = {}, {}, {}, {}
    for tf in config.INTERVALS:
        syms = [s for s in quality.usable(data_version, tf) if s in eq]
        if not syms:
            continue
        d = ingest.day_bounds(tf, syms)
        d = d[d >= rules.TRADE_FROM_DAY]  # splits are over the tradable history only
        if len(d) < 60:
            continue
        symbols[tf] = syms
        days[tf] = d
        bounds[tf] = validation.split_days(d)
        screen[tf] = _liquid(syms, bounds[tf][0], S1_SCREEN_SYMBOLS)
    if not symbols:
        raise RuntimeError("no usable data — run ingest and quality first")
    all_syms = sorted(set().union(*symbols.values()))
    # Regime series: the NIFTY ETF reaches back to 2003, Groww's index only to
    # 2015-08. The regime flags (above EMA200, ATR% vs its average) are
    # scale-free, so the ETF stands in for the index.
    reg = config.BENCHMARK
    nf = load_frame(reg, 1440)
    if nf is None or not len(nf):
        reg, nf = "NIFTY", load_frame("NIFTY", 1440)
    ctx = Context(data_version, symbols, days, bounds, screen, quality.breaks(data_version),
                  {s: i for i, s in enumerate(all_syms)}, ml.Nifty(Series(reg, 1440, nf) if nf is not None and len(nf) else None),
                  membership, n_snaps, _delivery())
    return ctx


def _liquid(syms: list[str], before_day: int, k: int) -> list[str]:
    """Top-k by median daily turnover, measured only on days before `before_day`
    (the training period) — no future information in the choice."""
    scored = []
    for s in syms:
        df = load_frame(s, 1440)
        if df is None:
            continue
        df = cut(df, 1440, None, before_day)
        if len(df) < 20:
            continue
        scored.append((float(np.median(df["close"] * df["volume"])), s))
    scored.sort(reverse=True)
    return [s for _, s in scored[:k]]


# ------------------------------------------------------------ pieces
def _frame(symbol: str, tf: int) -> tuple[pd.DataFrame | None, list[int]]:
    """Candles, with intraday bars reconciled against the adjusted daily bars
    (bad ticks clipped) and the intraday corporate-action days to cut at."""
    df = load_frame(symbol, tf)
    if tf >= 1440 or df is None or df.empty:
        return df, []
    df, steps, _ = quality.reconcile(df, load_frame(symbol, 1440))
    return df, steps


def pieces(ctx: Context, symbol: str, tf: int, day_to: int | None = None):
    """The symbol's series cut at suspected corporate actions; each piece comes
    with a loader for its own higher-timeframe series over the same days."""
    df, steps = _frame(symbol, tf)
    if df is None or df.empty:
        return
    df = cut(df, tf, rules.TRADE_FROM_DAY - config.WARMUP_DAYS, day_to)
    br = sorted(set(ctx.breaks.get(symbol, [])) | set(steps))
    lo_edges = [None] + br
    hi_edges = br + [day_to]
    htf_frames: dict[int, pd.DataFrame | None] = {}
    for lo, hi in zip(lo_edges, hi_edges):
        part = cut(df, tf, lo, hi)
        if len(part) < MIN_PIECE_BARS:
            continue
        s = Series(symbol, tf, part)
        s.member = ctx.member(symbol, s.day)
        if s.member is not None and not s.member.any():
            continue
        s.deliv = ctx.delivery.get(symbol)
        cache: dict[int, Series | None] = {}

        def loader(htf: int, lo=lo, hi=hi, cache=cache):
            if htf not in cache:
                if htf not in htf_frames:
                    htf_frames[htf] = _frame(symbol, htf)[0]
                f = htf_frames[htf]
                cache[htf] = Series(symbol, htf, cut(f, htf, lo, hi)) if f is not None else None
            return cache[htf]

        yield s, loader


def evaluate(s: Series, loader, dnas: list[dict], on_trades, cost_multiplier: float = 1.0) -> Cache:
    ic = Cache(s, loader)
    for k, d in enumerate(dnas):
        sig = rules.build(d, ic)
        if not sig[0].any() and not sig[1].any():
            continue
        tr = engine.run(s, d, sig, engine.stop_atr(d, ic), cost_multiplier=cost_multiplier)
        if len(tr):
            on_trades(k, tr)
    return ic


def _ckpt(run_id: int, name: str):
    config.CHECKPOINTS.mkdir(parents=True, exist_ok=True)
    return config.CHECKPOINTS / f"run{run_id}_{name}.npz"


def _metric_rows(run_id: int, hashes: list[str], table: AggTable, segment: str, status: list[str], reason: list[str | None]):
    rows = []
    for k, h in enumerate(hashes):
        r = table.row(k)
        rows.append((run_id, h, segment, r["trades"], r["wins"], r["gross_profit"], r["gross_loss"], r["costs"], r["net_pnl"],
                     r["profit_factor"], r["win_rate"], r["expectancy"], r["sharpe"], r["t_stat"], r["max_dd"], r["avg_hold_bars"],
                     r["symbols"], status[k], reason[k]))
    db.executemany(
        "INSERT OR REPLACE INTO strategy_metrics(run_id, strategy_hash, segment, trades, wins, gross_profit, gross_loss, costs, net_pnl, "
        "profit_factor, win_rate, expectancy, sharpe, t_stat, max_dd, avg_hold_bars, symbols, status, reason) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )


def _gate(table: AggTable, min_trades: int, min_pf: float, keep: int) -> tuple[list[str], list[str | None]]:
    status, reason = [], []
    passed = []
    for k in range(table.m):
        r = table.row(k)
        why = None
        if r["trades"] == 0:
            why = "no trades"
        elif r["trades"] < min_trades:
            why = f"trades<{min_trades}"
        elif r["net_pnl"] <= 0:
            why = "net<=0"
        elif r["profit_factor"] is None or r["profit_factor"] < min_pf:
            why = f"pf<{min_pf}"
        status.append("rejected" if why else "passed")
        reason.append(why)
        if not why:
            passed.append((r["t_stat"] or 0.0, k))
    passed.sort(reverse=True)
    for rank, (_, k) in enumerate(passed):
        if rank < keep:
            status[k] = "advanced"
        else:
            reason[k] = f"passed; outside top {keep} by t-stat"
    return status, reason


def _definitions(prog: Program = MAIN) -> list[tuple[str, dict]]:
    with db.tx() as con:
        return [(r["hash"], json.loads(r["dna"])) for r in con.execute(
            "SELECT hash, dna FROM strategy_definitions WHERE version=? ORDER BY id", (prog.dna_version,))]


# ------------------------------------------------------------ generate
def generate(total: int | None = None, seed: int | None = None, prog: Program = MAIN) -> dict:
    total = prog.total if total is None else total
    seed = prog.seed if seed is None else seed
    t0 = time.time()
    defs = dnamod.generate(total, seed, version=prog.dna_version)
    now = time.time()
    db.executemany(
        "INSERT OR IGNORE INTO strategy_definitions(hash, id, family, tf, dna, version, created_at) VALUES(?,?,?,?,?,?,?)",
        [(h, i, d["family"], d["tf"], dnamod.canonical(d), prog.dna_version, now) for i, h, d in defs],
    )
    with db.tx() as con:
        n = con.execute("SELECT COUNT(*) FROM strategy_definitions WHERE version=?", (prog.dna_version,)).fetchone()[0]
        by = {r[0]: r[1] for r in con.execute(
            "SELECT family, COUNT(*) FROM strategy_definitions WHERE version=? GROUP BY family", (prog.dna_version,))}
    log(f"generated {len(defs)} definitions ({n} stored) in {time.time() - t0:.1f}s")
    return {"generated": len(defs), "stored": n, "by_family": by, "seed": seed}


# ------------------------------------------------------------ stage 1
def screen(ctx: Context, run_id: int, prog: Program = MAIN) -> dict:
    defs = _definitions(prog)
    done = db.chunks_finished(run_id)
    summary_ = {"by_tf": {}}
    sharpes = []
    for tf in config.INTERVALS:
        sub = [(h, d) for h, d in defs if d["tf"] == tf]
        if not sub or tf not in ctx.symbols:
            if sub:
                _metric_rows(run_id, [h for h, _ in sub], AggTable(len(sub)), "train", ["rejected"] * len(sub), [f"no usable {tf}m data"] * len(sub))
            continue
        hashes, dnas = [h for h, _ in sub], [d for _, d in sub]
        path = _ckpt(run_id, f"s1_{tf}")
        table = AggTable.load(path, len(sub)) if path.exists() else AggTable(len(sub))
        val_start, _ = ctx.bounds[tf]
        t0 = time.time()
        for i, sym in enumerate(ctx.screen[tf]):
            chunk = f"s1:{tf}:{sym}"
            if chunk in done:
                continue
            sid = ctx.sym_id[sym]
            for s, loader in pieces(ctx, sym, tf, day_to=val_start):
                evaluate(s, loader, dnas, lambda k, tr: table.add(k, tr.net, tr.costs, tr.notional, tr.x_i - tr.e_i + 1, sid))
            table.save(path)
            db.chunk_done(run_id, chunk)
            db.progress(run_id, {"stage": "screen", "tf": tf, "symbol": sym, "done": i + 1, "of": len(ctx.screen[tf]), "strategies": len(sub),
                                 "elapsed_s": round(time.time() - t0)})
            log(f"screen {tf}m {i + 1}/{len(ctx.screen[tf])} {sym} ({len(sub)} strategies, {time.time() - t0:.0f}s)")
        status, reason = _gate(table, S1_MIN_TRADES, S1_MIN_PF, S1_KEEP_PER_TF)
        _metric_rows(run_id, hashes, table, "train", status, reason)
        for k in range(table.m):
            if table.trades[k] >= S1_MIN_TRADES:
                r = table.row(k)
                if r["sharpe"] is not None:
                    sharpes.append(r["sharpe"])
        summary_["by_tf"][str(tf)] = {
            "strategies": len(sub), "with_trades": int((table.trades > 0).sum()),
            "passed": int(sum(s != "rejected" for s in status)), "advanced": int(sum(s == "advanced" for s in status)),
        }
    summary_["n_trials"] = len(defs)
    summary_["sr_var"] = float(np.var(sharpes, ddof=1)) if len(sharpes) > 1 else 0.0
    summary_["backtests"] = sum(v["strategies"] for v in summary_["by_tf"].values())
    return summary_


def _advanced(run_id: int, segment: str) -> set[str]:
    with db.tx() as con:
        return {r[0] for r in con.execute(
            "SELECT strategy_hash FROM strategy_metrics WHERE run_id=? AND segment=? AND status='advanced'", (run_id, segment))}


# ------------------------------------------------------------ stage 2
def validate(ctx: Context, run_id: int, screen_run: int, prog: Program = MAIN) -> dict:
    keep = _advanced(screen_run, "train")
    defs = [(h, d) for h, d in _definitions(prog) if h in keep]
    done = db.chunks_finished(run_id)
    out = {"by_tf": {}}
    all_p, all_h, fold_rows, month_cols = [], [], [], []
    for tf in config.INTERVALS:
        sub = [(h, d) for h, d in defs if d["tf"] == tf]
        if not sub:
            continue
        hashes, dnas = [h for h, _ in sub], [d for _, d in sub]
        m = len(sub)
        val_start, test_start = ctx.bounds[tf]
        first = int(ctx.days[tf][0])
        folds = validation.fold_edges(first, test_start, WF_FOLDS)
        m0 = int(np.datetime64(validation.day_to_date(first), "M").astype(int))
        n_months = int(np.datetime64(validation.day_to_date(test_start), "M").astype(int)) - m0 + 1
        p_tr, p_va, p_ex = _ckpt(run_id, f"s2_{tf}_train"), _ckpt(run_id, f"s2_{tf}_val"), _ckpt(run_id, f"s2_{tf}_extra")
        t_tr = AggTable.load(p_tr, m) if p_tr.exists() else AggTable(m)
        t_va = AggTable.load(p_va, m) if p_va.exists() else AggTable(m)
        if p_ex.exists():
            z = np.load(p_ex)
            fmat, mmat = z["folds"].copy(), z["months"].copy()
        else:
            fmat, mmat = np.zeros((m, WF_FOLDS)), np.zeros((m, n_months))
        edges = np.array([a for a, _ in folds] + [folds[-1][1]])
        t0 = time.time()
        syms = ctx.symbols[tf]
        for i, sym in enumerate(syms):
            chunk = f"s2:{tf}:{sym}"
            if chunk in done:
                continue
            sid = ctx.sym_id[sym]

            def on(k, tr):
                is_tr = tr.entry_day < val_start
                bars = tr.x_i - tr.e_i + 1
                if is_tr.any():
                    t_tr.add(k, tr.net[is_tr], tr.costs[is_tr], tr.notional[is_tr], bars[is_tr], sid)
                if (~is_tr).any():
                    v = ~is_tr
                    t_va.add(k, tr.net[v], tr.costs[v], tr.notional[v], bars[v], sid)
                fi = np.clip(np.searchsorted(edges, tr.entry_day, side="right") - 1, 0, WF_FOLDS - 1)
                np.add.at(fmat[k], fi, tr.net)
                mi = np.clip(tr.entry_day.astype("datetime64[D]").astype("datetime64[M]").astype(int) - m0, 0, n_months - 1)
                np.add.at(mmat[k], mi, tr.net)

            for s, loader in pieces(ctx, sym, tf, day_to=test_start):
                evaluate(s, loader, dnas, on)
            t_tr.save(p_tr)
            t_va.save(p_va)
            np.savez(p_ex.with_suffix(".tmp.npz"), folds=fmat, months=mmat)
            p_ex.with_suffix(".tmp.npz").replace(p_ex)
            db.chunk_done(run_id, chunk)
            db.progress(run_id, {"stage": "validate", "tf": tf, "symbol": sym, "done": i + 1, "of": len(syms), "strategies": m,
                                 "elapsed_s": round(time.time() - t0)})
            if i % 10 == 0:
                log(f"validate {tf}m {i + 1}/{len(syms)} {sym} ({m} strategies, {time.time() - t0:.0f}s)")
        _metric_rows(run_id, hashes, t_tr, "train_full", ["evaluated"] * m, [None] * m)
        status, reason = _gate(t_va, S2_MIN_TRADES, S2_MIN_PF, S2_KEEP_PER_TF)
        _metric_rows(run_id, hashes, t_va, "validation", status, reason)
        vr = []
        for k, h in enumerate(hashes):
            all_p.append(t_va.pvalue(k))
            all_h.append(h)
            mean, sd, sk, ku = t_va.moments(k)
            sr = mean / sd if (sd and mean is not None) else None
            vr.append((run_id, h, "validation_moments", json.dumps({"sr": sr, "T": int(t_va.trades[k]), "skew": sk, "kurt": ku})))
            vr.append((run_id, h, "wf_folds", json.dumps({"pnl": fmat[k].tolist(), "positive_frac": float((fmat[k] > 0).mean()),
                                                         "edges": [validation.day_to_date(int(e)).isoformat() for e in edges]})))
        db.executemany("INSERT OR REPLACE INTO validation_results(run_id, strategy_hash, test, value) VALUES(?,?,?,?)", vr)
        fold_rows.append(fmat)
        month_cols.append(mmat)
        out["by_tf"][str(tf)] = {"strategies": m, "advanced": int(sum(s == "advanced" for s in status)),
                                 "passed": int(sum(s != "rejected" for s in status))}

    # Multiple testing across everything that reached validation.
    disc = validation.bh_fdr(np.array(all_p), q=0.10)
    db.executemany(
        "INSERT OR REPLACE INTO validation_results(run_id, strategy_hash, test, value) VALUES(?,?,?,?)",
        [(run_id, h, "fdr", json.dumps({"p": p, "pass": bool(x), "q": 0.10})) for h, p, x in zip(all_h, all_p, disc)],
    )
    out["fdr_discoveries"] = int(disc.sum())
    out["fdr_tested"] = len(all_p)
    if fold_rows:
        F = np.vstack(fold_rows)
        out["walk_forward_selection"] = validation.walk_forward_selection(F, top=20)
        # PBO over months, per interval (months differ by interval history), worst reported.
        pbos = {}
        for tf_key, M in zip([k for k in out["by_tf"]], month_cols):
            active = M[:, np.abs(M).sum(axis=0) > 0]
            if active.shape[1] >= 10 and active.shape[0] >= 2:
                pbos[tf_key] = validation.pbo(active.T, n_blocks=10)
        out["pbo"] = pbos
    return out


# ------------------------------------------------------------ stage 3
def deep(ctx: Context, run_id: int, validate_run: int, screen_run: int, prog: Program = MAIN) -> dict:
    keep = _advanced(validate_run, "validation")
    defs_all = _definitions(prog)
    defs = [(h, d) for h, d in defs_all if h in keep]
    screen_summary: dict = {}
    with db.tx() as con:
        r = con.execute("SELECT summary FROM runs WHERE id=?", (screen_run,)).fetchone()
        if r and r[0]:
            screen_summary = json.loads(r[0])
    n_trials = int(screen_summary.get("n_trials", len(defs_all)))
    sr_var = float(screen_summary.get("sr_var", 0.0))
    done = db.chunks_finished(run_id)
    ds_dir = config.DATA / "ml" / f"run{run_id}"
    ds_dir.mkdir(parents=True, exist_ok=True)
    out = {"by_tf": {}, "n_trials": n_trials, "sr_var": sr_var}
    with db.tx() as con:
        est = {r[0]: float(r[1] or 0) for r in con.execute(
            "SELECT strategy_hash, SUM(trades) FROM strategy_metrics WHERE run_id=? AND segment IN ('train_full','validation') "
            "GROUP BY strategy_hash", (validate_run,))}

    for tf in config.INTERVALS:
        sub = [(h, d) for h, d in defs if d["tf"] == tf]
        if not sub:
            continue
        hashes, dnas = [h for h, _ in sub], [d for _, d in sub]
        val_start, test_start = ctx.bounds[tf]
        # Neighbours: one grid step away; evaluated on train+validation only.
        neigh, parent = [], []
        seen = set(hashes)
        for k, d in enumerate(dnas):
            got = 0
            for nd in dnamod.neighbours(d):
                h = dnamod.dna_hash(nd)
                if h in seen or got >= MAX_NEIGHBOURS:
                    continue
                seen.add(h)
                neigh.append(nd)
                parent.append(k)
                got += 1
        p_nb = _ckpt(run_id, f"s3_{tf}_neigh")
        t_nb = AggTable.load(p_nb, len(neigh)) if p_nb.exists() else AggTable(max(1, len(neigh)))
        strat_feats = [ml.strategy_features(d) for d in dnas]
        # ML rows are sampled per strategy (seeded) so the dataset stays near
        # ML_ROWS_PER_STRATEGY rows each, whatever the trade count; the trade
        # table itself keeps every trade.
        keep_p = np.array([min(1.0, ML_ROWS_PER_STRATEGY / max(1.0, est.get(h, 0.0) / (1 - config.SPLIT[2]))) for h in hashes])
        # Regime tallies over ALL train+validation trades: [strategy, bull, volhi, (count, net)].
        p_rg = _ckpt(run_id, f"s3_{tf}_regime")
        regime = np.load(p_rg)["r"].copy() if p_rg.exists() else np.zeros((len(sub), 2, 2, 2))
        t0 = time.time()
        syms = ctx.symbols[tf]
        for i, sym in enumerate(syms):
            chunk = f"s3:{tf}:{sym}"
            if chunk in done:
                continue
            sid = ctx.sym_id[sym]
            feat_parts = []
            con = db.connect()
            try:
                for s, loader in pieces(ctx, sym, tf, day_to=None):
                    bag: list[tuple[int, engine.Trades]] = []
                    ic = evaluate(s, loader, dnas, lambda k, tr: bag.append((k, tr)))
                    if not bag:
                        continue
                    feats = ml.piece_features(ic, ctx.nifty)
                    for k, tr in bag:
                        seg = np.where(tr.entry_day < val_start, "train", np.where(tr.entry_day < test_start, "validation", "test"))
                        bars = tr.x_i - tr.e_i + 1
                        con.executemany(TRADE_SQL, (
                            (run_id, hashes[k], sym, str(seg[j]), int(tr.side[j]), int(tr.entry_time[j]), int(tr.exit_time[j]),
                             float(tr.entry_px[j]), float(tr.exit_px[j]), int(tr.qty[j]), float(tr.gross[j]),
                             float(tr.costs[j]), float(tr.net[j]), int(bars[j]), engine.REASONS[int(tr.reason[j])])
                            for j in range(len(tr))))
                        sig_i = tr.e_i - 1
                        bull, volhi = feats["nifty_bull"][sig_i], feats["nifty_volhi"][sig_i]
                        known = ~np.isnan(bull) & ~np.isnan(volhi) & (seg != "test")
                        for b in (0, 1):
                            for v in (0, 1):
                                m = known & (bull == b) & (volhi == v)
                                regime[k, b, v, 0] += m.sum()
                                regime[k, b, v, 1] += tr.net[m].sum()
                        rng = np.random.default_rng([int(hashes[k][:8], 16), sid])
                        pick = rng.random(len(tr)) < keep_p[k]
                        if not pick.any():
                            continue
                        part = {f: feats[f][sig_i[pick]].astype(np.float32) for f in ml.MARKET_FEATURES}
                        for f, v in strat_feats[k].items():
                            part[f] = np.full(int(pick.sum()), v, dtype=np.float32)
                        part.update({"strategy_hash": hashes[k], "symbol": sym, "segment": seg[pick], "entry_time": tr.entry_time[pick],
                                     "exit_time": tr.exit_time[pick], "net": tr.net[pick], "notional": tr.notional[pick]})
                        feat_parts.append(pd.DataFrame(part))
                # neighbours on train+validation only
                if neigh:
                    for s, loader in pieces(ctx, sym, tf, day_to=test_start):
                        evaluate(s, loader, neigh, lambda k, tr: t_nb.add(k, tr.net, tr.costs, tr.notional, tr.x_i - tr.e_i + 1, sid))
                    t_nb.save(p_nb)
                np.savez(p_rg.with_suffix(".tmp.npz"), r=regime)
                p_rg.with_suffix(".tmp.npz").replace(p_rg)
                if feat_parts:
                    pd.concat(feat_parts, ignore_index=True).to_parquet(ds_dir / f"{tf}_{sym}.parquet", index=False)
                con.execute("INSERT OR REPLACE INTO run_chunks(run_id, chunk, finished_at) VALUES(?,?,?)", (run_id, chunk, time.time()))
                con.commit()
            except BaseException:
                con.rollback()
                raise
            finally:
                con.close()
            db.progress(run_id, {"stage": "deep", "tf": tf, "symbol": sym, "done": i + 1, "of": len(syms), "strategies": len(sub),
                                 "neighbours": len(neigh), "elapsed_s": round(time.time() - t0)})
            if i % 10 == 0:
                log(f"deep {tf}m {i + 1}/{len(syms)} {sym} ({len(sub)} strategies + {len(neigh)} neighbours, {time.time() - t0:.0f}s)")

        # ---- per-strategy analysis from stored trades
        first = int(ctx.days[tf][0])
        folds = validation.fold_edges(first, test_start, WF_FOLDS)
        vrows, mrows = [], []
        for k, h in enumerate(hashes):
            T = _trades(run_id, h)
            res = _analyse(T, folds, n_trials, sr_var, prog)
            nb = [t_nb.row(j) for j in range(len(neigh)) if parent[j] == k]
            own = res["segments"].get("trainval", {}).get("expectancy")
            nb_exp = [r["expectancy"] for r in nb if r["expectancy"] is not None]
            res["stability"] = {
                "neighbours": len(nb),
                "profitable_frac": float(np.mean([e > 0 for e in nb_exp])) if nb_exp else None,
                "median_ratio": float(np.median(nb_exp) / own) if nb_exp and own else None,
            }
            res["regimes"] = {
                f"{'bull' if b else 'bear'}_{'highvol' if v else 'lowvol'}": {"trades": int(regime[k, b, v, 0]), "net": float(regime[k, b, v, 1])}
                for b in (0, 1) for v in (0, 1)
            }
            for seg, r in res["segments"].items():
                mrows.append((run_id, h, seg, r["trades"], r["wins"], r["gross_profit"], r["gross_loss"], r["costs"], r["net_pnl"],
                              r["profit_factor"], r["win_rate"], r["expectancy"], r["sharpe"], r["t_stat"], r["max_dd"],
                              r["avg_hold_bars"], r["symbols"], "evaluated", None))
            for test in ("walk_forward", "monte_carlo", "cost_x2", "portfolio", "portfolio_test", "by_year", "dsr", "stability", "regimes"):
                if test in res:
                    vrows.append((run_id, h, test, json.dumps(res[test])))
        db.executemany(
            "INSERT OR REPLACE INTO strategy_metrics(run_id, strategy_hash, segment, trades, wins, gross_profit, gross_loss, costs, net_pnl, "
            "profit_factor, win_rate, expectancy, sharpe, t_stat, max_dd, avg_hold_bars, symbols, status, reason) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", mrows)
        db.executemany("INSERT OR REPLACE INTO validation_results(run_id, strategy_hash, test, value) VALUES(?,?,?,?)", vrows)
        out["by_tf"][str(tf)] = {"strategies": len(sub), "neighbours": len(neigh)}
    return out


def _trades(run_id: int, h: str) -> pd.DataFrame:
    with db.tx() as con:
        return pd.read_sql_query(
            "SELECT symbol, segment, side, entry_time, exit_time, entry_px, exit_px, qty, gross, costs, net, bars FROM strategy_trades "
            "WHERE run_id=? AND strategy_hash=?", con, params=(run_id, h))


def _analyse(T: pd.DataFrame, folds, n_trials: int, sr_var: float, prog: Program = MAIN) -> dict:
    res: dict = {"segments": {}}
    if T.empty:
        return res
    T = T.copy()
    T["notional"] = T.entry_px * T.qty
    T["day"] = (T.entry_time // 1000 + config.IST_OFFSET_S) // 86_400
    sym_codes = {s: i for i, s in enumerate(sorted(T.symbol.unique()))}
    T["sid"] = T.symbol.map(sym_codes)
    tv = T[T.segment != "test"]
    for seg, g in (("train", T[T.segment == "train"]), ("validation", T[T.segment == "validation"]), ("trainval", tv), ("test", T[T.segment == "test"])):
        if len(g):
            res["segments"][seg] = summary(g.net.to_numpy(), g.costs.to_numpy(), g.notional.to_numpy(), g.bars.to_numpy(),
                                           g.exit_time.to_numpy(), g.symbol.nunique())
    if len(tv):
        net = tv.net.to_numpy()
        res["walk_forward"] = {"pnl": validation.fold_pnl(tv.day.to_numpy(), net, folds)}
        res["walk_forward"]["positive_frac"] = float(np.mean([p > 0 for p in res["walk_forward"]["pnl"]]))
        res["monte_carlo"] = validation.monte_carlo(net)
        slip = config.SLIPPAGE_BPS / 10_000
        net2 = net - tv.costs.to_numpy() - slip * (tv.notional.to_numpy() + (tv.exit_px * tv.qty).to_numpy())
        res["cost_x2"] = {"net": float(net2.sum()), "per_trade": float(net2.mean())}
        taken, daily = validation.portfolio_curve(tv.entry_time.to_numpy(), tv.exit_time.to_numpy(), net, tv.sid.to_numpy(),
                                                  book=prog.book, max_pos=prog.max_pos)
        res["portfolio"] = {**validation.curve_stats(daily, book=prog.book), "trades_taken": int(taken.sum()), "trades_offered": int(len(tv)),
                            "book": prog.book, "max_positions": prog.max_pos}
        va = T[T.segment == "validation"]
        r = (va.net / va.notional).to_numpy()
        res["dsr"] = validation.deflated_sharpe(r, n_trials, sr_var)
    te = T[T.segment == "test"]
    if len(te):
        taken, daily = validation.portfolio_curve(te.entry_time.to_numpy(), te.exit_time.to_numpy(), te.net.to_numpy(), te.sid.to_numpy(),
                                                  book=prog.book, max_pos=prog.max_pos)
        res["portfolio_test"] = {**validation.curve_stats(daily, book=prog.book), "trades_taken": int(taken.sum()),
                                 "trades_offered": int(len(te)), "book": prog.book, "max_positions": prog.max_pos}
    years = pd.to_datetime(T.entry_time, unit="ms", utc=True).dt.tz_convert("Asia/Kolkata").dt.year
    res["by_year"] = {str(y): {"trades": int(len(g)), "net": float(g.net.sum()), "segments": sorted(g.segment.unique().tolist())}
                      for y, g in T.groupby(years)}
    return res


# ------------------------------------------------------------ orchestration
def step(kind: str, fn, data_version: str | None, params: dict | None = None):
    rid = db.start_run(kind, params or {}, data_version, config.SEED)
    log(f"run {rid}: {kind} started")
    try:
        result = fn(rid)
        db.finish_run(rid, "done", result)
        log(f"run {rid}: {kind} done")
        return rid, result
    except BaseException as e:
        db.finish_run(rid, "failed", error=f"{type(e).__name__}: {e}")
        raise


def resume_or_start(kind: str, fn, data_version: str, params: dict):
    """Continue the latest unfinished run of this kind on the same data, else start one."""
    with db.tx() as con:
        r = con.execute("SELECT id FROM runs WHERE kind=? AND status IN ('running','failed') AND data_version=? ORDER BY id DESC LIMIT 1",
                        (kind, data_version)).fetchone()
    if r is None:
        return step(kind, fn, data_version, params)
    rid = int(r[0])
    with db.tx() as con:
        con.execute("UPDATE runs SET status='running', error=NULL WHERE id=?", (rid,))
    log(f"run {rid}: {kind} resumed")
    try:
        result = fn(rid)
        db.finish_run(rid, "done", result)
        return rid, result
    except BaseException as e:
        db.finish_run(rid, "failed", error=f"{type(e).__name__}: {e}")
        raise


def research(data_version: str | None = None, prog: Program = MAIN) -> dict:
    """screen → validate → deep → rank → train on the latest data version."""
    from . import ranking

    data_version = data_version or ingest.latest_version()
    if not data_version:
        raise RuntimeError("no data version — run ingest first")
    with db.tx() as con:
        if con.execute("SELECT COUNT(*) FROM strategy_definitions WHERE version=?", (prog.dna_version,)).fetchone()[0] == 0:
            generate(prog=prog)
    ctx = build_context(data_version)
    params = {**ctx.params(), "program": prog.__dict__}
    k = prog.kind
    s1, _ = resume_or_start(k("screen"), lambda rid: screen(ctx, rid, prog), data_version, params)
    s2, _ = resume_or_start(k("validate"), lambda rid: validate(ctx, rid, s1, prog), data_version, {**params, "screen_run": s1})
    s3, _ = resume_or_start(k("deep"), lambda rid: deep(ctx, rid, s2, s1, prog), data_version, {**params, "validate_run": s2})
    rk, rk_res = step(k("rank"), lambda rid: ranking.rank(rid, s3, s2), data_version, {"deep_run": s3, "validate_run": s2})
    tr, tr_res = step(k("train"), lambda rid: ml.train(rid, config.DATA / "ml" / f"run{s3}"), data_version, {"deep_run": s3})
    return {"screen": s1, "validate": s2, "deep": s3, "rank": rk, "train": tr, "ranking": rk_res, "model": tr_res}
