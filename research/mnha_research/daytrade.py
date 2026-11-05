"""The intraday ranking model: each morning at the 09:15 open, which liquid
F&O stocks will do better (or worse) than the rest by the close?

Cash equity only, MIS: long the top names, short the bottom names, flat the
same day — no overnight risk, intraday costs (no delivery STT). The model
sees only what is known at the open:
  * the opening gap, raw and in units of the stock's own ATR, and relative
    to the market's median gap;
  * the last sessions: returns over 1/5/20/60 days, the last day's intraday
    move, where it closed in its range, its range, volume surge, up/down
    streak, distance from short and long EMAs, volatility, liquidity;
  * NSE delivery share of traded quantity (yesterday's, published after the
    close) and its change;
  * stock-futures open interest (yesterday's bhavcopy): 1- and 5-day change,
    and the put/call open-interest ratio — used as information only, nothing
    is traded in F&O;
  * the market: median gap, NIFTYBEES gap, breadth, dispersion, recent trend.

Protocol — expanding-window walk-forward, yearly refits, never shuffled:
labels are same-day (open -> close), so a model fitted on every session
before 1 January of year Y predicts every session of Y.

SEALED HOLDOUT: sessions from HOLDOUT_FROM on are not predicted at all in
development mode, so they cannot steer any design choice. `run(final=True)`
predicts them once, and the run summary records that it did and how many
configurations were tried before it.

Execution on daily bars: entry at the open with ENTRY_SLIP_BPS (the decision
uses the opening price itself, so the fill is charged as if it were worse
than the auction price), exit at the close with EXIT_SLIP_BPS. MIS positions
are squared off around 15:15, not at the official close, so `replay_5m`
re-prices the trades of 2020 onward from 5-minute bars: entry at the close of
the first 5-minute bar (09:20, after the open is known), exit at the close of
the bar ending 15:15.

Eligibility at the open uses only the open and earlier bars. A bar whose open
lies outside its own high-low range is corrupt data: no trade is taken on it
(`tradable`), whichever way the day went.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from . import alpha, config, db, ingest, pit, quality
from .costs import COST_MODEL_VERSION, trade_costs
from .series import load_frame
from .sessions import ist_day, ist_minute
from .validation import day_to_date

BOOK = 500_000.0
LIQUID_N = 150
MIN_HISTORY = 260
MIN_NAMES = 30
FIRST_ROW_DAY = (dt.date(2010, 3, 1) - dt.date(1970, 1, 1)).days  # opens reliable from 2010; a warm-up for 20-day stats
KEEP_FROM_DAY = (dt.date(2009, 1, 1) - dt.date(1970, 1, 1)).days
MIN_TRAIN_YEARS = 4
HOLDOUT_FROM = dt.date(2024, 1, 1)
ENTRY_SLIP_BPS = 8.0
EXIT_SLIP_BPS = 3.0
LABEL_CLIP = 0.10
HGB = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=2000, l2_regularization=1.0)

# Pre-registered portfolio rules. All are reported; none is chosen by the holdout.
CONFIGS = {
    "ls3": {"long": 3, "short": 3, "hurdle": 0.0},
    "long5": {"long": 5, "short": 0, "hurdle": 0.0},
    "short5": {"long": 0, "short": 5, "hurdle": 0.0},
    "ls3_hurdle": {"long": 3, "short": 3, "hurdle": 0.002},  # only names the model expects to beat costs
}

RANKED = ["gap", "gap_z", "rel_gap", "r1", "r5", "r20", "r60", "oc1", "gap1", "ibs1", "rng1", "vol20", "atr_pct", "relvol1",
          "streak", "dist_ema10", "dist_ema50", "liq", "deliv1", "deliv_rel", "deliv_chg5", "oi_chg1", "oi_chg5", "pcr", "pcr_chg5"]
RAW = ["gap_raw", "gap_z_raw", "rel_gap_raw", "atr_pct_raw"]
MARKET = ["m_gap", "b_gap", "m_gap_disp", "m_r1", "m_r5", "m_r20", "m_breadth", "m_disp", "dow"]
FEATURES = [f"p_{k}" for k in RANKED] + RAW + MARKET

log = alpha.log
NSE = config.DATA / "nse"


# ------------------------------------------------------------ data
def _side_matrix(path, days: np.ndarray, symbols: list[str], cols: list[str]) -> dict[str, np.ndarray]:
    out = {c: np.full((len(days), len(symbols)), np.nan) for c in cols}
    if not path.exists():
        return out
    df = pd.read_parquet(path)
    col = {s: j for j, s in enumerate(symbols)}
    df = df[df["symbol"].isin(col)]
    di = np.searchsorted(days, df["day"].to_numpy())
    ok = (di < len(days)) & (days[np.minimum(di, len(days) - 1)] == df["day"].to_numpy())
    jj = df["symbol"].map(col).to_numpy()
    for c in cols:
        out[c][di[ok], jj[ok]] = df[c].to_numpy(dtype=float)[ok]
    return out


def load(data_version: str | None = None) -> dict:
    """Panel of usable current and former F&O stocks, point-in-time membership,
    delivery share and open interest on the same calendar."""
    v = data_version or ingest.latest_version()
    usable = set(quality.usable(v, 1440)) if v else None
    syms = [s for s in ingest.stocks() if usable is None or s in usable]
    p = alpha.load_panel(syms)
    keep = p.days >= KEEP_FROM_DAY  # earlier rows only feed the 260-session history count
    hist0 = np.isfinite(p.C[~keep]).sum(axis=0)
    p = alpha.Panel(p.days[keep], p.symbols, p.O[keep], p.H[keep], p.L[keep], p.C[keep], p.V[keep],
                    p.bench_o[keep], p.bench_c[keep], p.actions)
    snaps = pit.snapshots()
    member = pit.mask(p.days, p.symbols, snaps)
    deliv = _side_matrix(NSE / "delivery.parquet", p.days, p.symbols, ["share"])["share"]
    oi = _side_matrix(NSE / "fo_oi.parquet", p.days, p.symbols, ["fut_oi", "ce_oi", "pe_oi"])
    return {"p": p, "member": member, "deliv": deliv, "oi": oi, "data_version": v, "hist0": hist0}


# ------------------------------------------------------------ features
def _pct(df: pd.DataFrame, elig: np.ndarray) -> np.ndarray:
    return df.where(elig).rank(axis=1, pct=True).to_numpy()


def _lag(a, k: int = 1) -> np.ndarray:
    a = np.asarray(a, dtype=float)
    out = np.full_like(a, np.nan)
    out[k:] = a[:-k]
    return out


def design(d: dict) -> dict:
    """Features for the decision at the OPEN of row t: everything from rows
    <= t-1, plus row t's open. Label: row t's open -> close."""
    p = d["p"]
    D, S = p.C.shape
    O, H, L, C, V = p.O, p.H, p.L, p.C, p.V
    Cf = pd.DataFrame(C).ffill(limit=5)
    C1 = _lag(C)  # yesterday's close
    with np.errstate(divide="ignore", invalid="ignore"):
        lr = np.log(Cf / Cf.shift(1))
        prev = Cf.shift(1).to_numpy()
        tr = np.nanmax(np.stack([H - L, np.abs(H - prev), np.abs(L - prev)]), axis=0) / C
        atr_pct = pd.DataFrame(tr).rolling(14, min_periods=10).mean().to_numpy()
        close_feats = {
            "r1": (Cf / Cf.shift(1) - 1).to_numpy(),
            "r5": (Cf / Cf.shift(5) - 1).to_numpy(),
            "r20": (Cf / Cf.shift(20) - 1).to_numpy(),
            "r60": (Cf / Cf.shift(60) - 1).to_numpy(),
            "oc1": C / O - 1,
            "gap1": O / prev - 1,
            "ibs1": np.where(H > L, (C - L) / (H - L), np.nan),
            "rng1": ((H - L) / C) / atr_pct,
            "vol20": lr.rolling(20, min_periods=15).std().to_numpy(),
            "atr_pct": atr_pct,
            "relvol1": V / pd.DataFrame(V).shift(1).rolling(20, min_periods=15).mean().to_numpy(),
            "dist_ema10": (Cf / Cf.ewm(span=10, min_periods=10).mean() - 1).to_numpy(),
            "dist_ema50": (Cf / Cf.ewm(span=50, min_periods=40).mean() - 1).to_numpy(),
            "liq": np.log(pd.DataFrame(C * V).rolling(60, min_periods=40).median().to_numpy()),
        }
        up = np.sign(np.nan_to_num(close_feats["r1"]))
        streak = np.zeros((D, S))
        for t in range(1, D):
            same = (up[t] == np.sign(streak[t - 1])) & (up[t] != 0)
            streak[t] = np.where(same, streak[t - 1] + up[t], up[t])
        close_feats["streak"] = streak
        sh = d["deliv"]
        sh_df = pd.DataFrame(sh)
        m20 = sh_df.shift(1).rolling(20, min_periods=10).mean().to_numpy()
        close_feats["deliv1"] = sh
        close_feats["deliv_rel"] = sh / m20
        close_feats["deliv_chg5"] = sh_df.rolling(5, min_periods=3).mean().to_numpy() / m20
        oi = pd.DataFrame(d["oi"]["fut_oi"]).replace(0, np.nan)
        close_feats["oi_chg1"] = np.log(oi / oi.shift(1)).to_numpy()
        close_feats["oi_chg5"] = np.log(oi / oi.shift(5)).to_numpy()
        ce, pe = pd.DataFrame(d["oi"]["ce_oi"]).replace(0, np.nan), pd.DataFrame(d["oi"]["pe_oi"])
        pcr = pe / ce
        close_feats["pcr"] = pcr.to_numpy()
        close_feats["pcr_chg5"] = (pcr / pcr.shift(5)).to_numpy()
        feats = {k: _lag(v) for k, v in close_feats.items()}  # known before the open
        gap = O / C1 - 1
        feats["gap"] = gap
        feats["gap_z"] = gap / feats["atr_pct"]

    # eligibility at the open of t
    member = d["member"] if d["member"] is not None else np.ones((D, S), dtype=bool)
    hist = np.cumsum(np.isfinite(C), axis=0) + d.get("hist0", 0)
    liq = feats["liq"]
    with np.errstate(invalid="ignore"):
        tradable = np.isfinite(C) & (C > 0) & (O <= H * 1.0001) & (O >= L * 0.9999)
        base = member & (_lag(hist) >= MIN_HISTORY) & np.isfinite(C1) & np.isfinite(liq) & np.isfinite(gap) & (O > 0)
    base &= (p.days >= FIRST_ROW_DAY)[:, None]
    liq_rank = pd.DataFrame(np.where(base, liq, np.nan)).rank(axis=1, ascending=False).to_numpy()
    elig = base & (liq_rank <= LIQUID_N)
    elig[elig.sum(axis=1) < MIN_NAMES] = False

    with np.errstate(invalid="ignore"):
        m_gap = np.nanmedian(np.where(elig, gap, np.nan), axis=1)
        feats["rel_gap"] = gap - m_gap[:, None]
        ranked = {f"p_{k}": _pct(pd.DataFrame(feats[k]), elig) for k in RANKED}
        clip = lambda a, lo, hi: np.clip(a, lo, hi)  # noqa: E731
        ranked["gap_raw"] = clip(gap, -0.2, 0.2)
        ranked["gap_z_raw"] = clip(feats["gap_z"], -10, 10)
        ranked["rel_gap_raw"] = clip(feats["rel_gap"], -0.2, 0.2)
        ranked["atr_pct_raw"] = clip(feats["atr_pct"], 0, 0.2)
        r1 = feats["r1"]
        bo, bc = p.bench_o, _lag(p.bench_c)
        market = {
            "m_gap": m_gap,
            "b_gap": bo / bc - 1,
            "m_gap_disp": np.nanstd(np.where(elig, gap, np.nan), axis=1),
            "m_r1": np.nanmedian(np.where(elig, r1, np.nan), axis=1),
            "m_r5": np.nanmedian(np.where(elig, feats["r5"], np.nan), axis=1),
            "m_r20": np.nanmedian(np.where(elig, feats["r20"], np.nan), axis=1),
            "m_breadth": np.nanmean(np.where(elig, feats["dist_ema50"] > 0, np.nan), axis=1),
            "m_disp": np.nanstd(np.where(elig, r1, np.nan), axis=1),
            "dow": ((p.days + 3) % 7).astype(float),
        }
        y = C / O - 1
        y = np.where(elig & tradable, y, np.nan)
        y_dm = np.clip(y - np.nanmean(y, axis=1, keepdims=True), -LABEL_CLIP, LABEL_CLIP)
    return {"d": d, "elig": elig, "tradable": tradable, "x": ranked, "m": market, "y": y, "y_dm": y_dm}


def matrix(des: dict, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(X, row index, symbol index) for eligible cells in `rows`."""
    e = des["elig"][rows]
    ii, jj = np.nonzero(e)
    r = rows[ii]
    cols = [des["x"][f"p_{k}"][r, jj] for k in RANKED] + [des["x"][k][r, jj] for k in RAW] + [des["m"][k][r] for k in MARKET]
    return np.column_stack(cols).astype(np.float32), ii, jj


# ------------------------------------------------------------ model
def _model(seed: int) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(**HGB, early_stopping=False, random_state=seed)


def walk_forward(des: dict, final: bool = False, seed: int = config.SEED) -> dict:
    p = des["d"]["p"]
    years = np.array([day_to_date(int(x)).year for x in p.days])
    rows_ok = des["elig"].any(axis=1)
    first_year = int(years[rows_ok][0]) if rows_ok.any() else 9999
    pred = np.full(des["y"].shape, np.nan, dtype=np.float32)
    folds = []
    for Y in range(first_year + MIN_TRAIN_YEARS, int(years[-1]) + 1):
        if not final and Y >= HOLDOUT_FROM.year:
            break
        train = np.nonzero(rows_ok & (years < Y))[0]
        test = np.nonzero(rows_ok & (years == Y))[0]
        if not len(test):
            continue
        X, ii, jj = matrix(des, train)
        yv = des["y_dm"][train[ii], jj]
        m = np.isfinite(yv)
        model = _model(seed).fit(X[m], yv[m])
        Xt, it, jt = matrix(des, test)
        pred[test[it], jt] = model.predict(Xt)
        folds.append({"year": Y, "train_rows": int(m.sum()), "test_sessions": int(len(test))})
        log(f"daytrade fold {Y}: {int(m.sum())} train rows, {len(test)} sessions")
    return {"pred": pred, "folds": folds}


# ------------------------------------------------------------ portfolio
def trades(des: dict, pred: np.ndarray, cfg: dict, rows: np.ndarray, entry_bps: float = ENTRY_SLIP_BPS,
           exit_bps: float = EXIT_SLIP_BPS, cost_mult: float = 1.0) -> pd.DataFrame:
    """Every position the rule takes on `rows`: entry at the open, exit at the close."""
    p = des["d"]["p"]
    n_slots = cfg["long"] + cfg["short"]
    slot = BOOK / n_slots
    es, xs = entry_bps / 1e4, exit_bps / 1e4
    out = []
    for t in rows:
        sc = np.where(des["elig"][t] & np.isfinite(pred[t]), pred[t], np.nan)
        ok = np.nonzero(np.isfinite(sc))[0]
        if len(ok) < MIN_NAMES:
            continue
        order = ok[np.argsort(-sc[ok], kind="stable")]
        hurdle = cfg["hurdle"]  # 0: always take the top / bottom names
        picks = [(j, 1) for j in order[: cfg["long"]] if hurdle <= 0 or sc[j] > hurdle]
        if cfg["short"]:
            picks += [(j, -1) for j in order[::-1][: cfg["short"]] if hurdle <= 0 or sc[j] < -hurdle]
        for j, side in picks:
            if not des["tradable"][t, j]:
                continue
            o, c = p.O[t, j], p.C[t, j]
            epx = o * (1 + es * side)
            xpx = c * (1 - xs * side)
            q = math.floor(slot / epx)
            if q <= 0:
                continue
            out.append((int(p.days[t]), p.symbols[j], side, q, epx, xpx, float(sc[j])))
    T = pd.DataFrame(out, columns=["day", "symbol", "side", "qty", "entry", "exit", "score"])
    if T.empty:
        return T.assign(gross=[], costs=[], net=[])
    ev, xv = T.qty * T.entry, T.qty * T.exit
    T["gross"] = (T.exit - T.entry) * T.qty * T.side
    T["costs"] = trade_costs(ev.to_numpy(), xv.to_numpy(), T.side.to_numpy(), T.day.to_numpy(), True) * cost_mult
    T["net"] = T.gross - T.costs
    return T


def book_stats(T: pd.DataFrame, first_day: int, last_day: int) -> dict:
    """₹ results on a fixed ₹5 lakh book (no compounding: each day uses the same slots)."""
    if T.empty:
        return {"trades": 0}
    daily = T.groupby("day").net.sum()
    eq = BOOK + daily.cumsum()
    peak = np.maximum.accumulate(np.concatenate([[BOOK], eq.to_numpy()]))[1:]
    dd = float(np.max((peak - eq.to_numpy()) / peak))
    years = max((last_day - first_day) / 365.25, 1 / 365.25)
    months = T.groupby(pd.to_datetime(T.day, unit="D").dt.to_period("M")).net.sum()
    yearly = T.groupby(pd.to_datetime(T.day, unit="D").dt.year).net.sum()
    sd = daily.std(ddof=1)
    return {
        "trades": int(len(T)), "days_traded": int(len(daily)),
        "net": float(T.net.sum()), "per_trade": float(T.net.mean()), "costs": float(T.costs.sum()),
        "win_rate": float((T.net > 0).mean()),
        "per_year_on_book": float(T.net.sum() / years / BOOK), "max_dd_on_book": dd,
        "sharpe": float(daily.mean() / sd * math.sqrt(252)) if sd > 0 else None,
        "months_positive": float((months > 0).mean()), "worst_month": float(months.min()),
        "per_month_avg": float(months.mean()),
        "by_year": {str(k): round(float(v)) for k, v in yearly.items()},
        "long": {"trades": int((T.side > 0).sum()), "net": float(T.net[T.side > 0].sum())},
        "short": {"trades": int((T.side < 0).sum()), "net": float(T.net[T.side < 0].sum())},
    }


def information(des: dict, pred: np.ndarray, rows: np.ndarray) -> dict:
    """Daily rank correlation of prediction with the open->close return."""
    ics = []
    for t in rows:
        m = des["elig"][t] & np.isfinite(pred[t]) & np.isfinite(des["y"][t])
        if m.sum() >= MIN_NAMES:
            ics.append(pd.Series(pred[t][m]).corr(pd.Series(des["y"][t][m]), method="spearman"))
    ics = np.array([x for x in ics if np.isfinite(x)])
    if not len(ics):
        return {"days": 0}
    return {"days": int(len(ics)), "ic_mean": float(ics.mean()), "ic_t": float(ics.mean() / ics.std(ddof=1) * math.sqrt(len(ics))),
            "ic_positive": float((ics > 0).mean())}


def replay_5m(T: pd.DataFrame, slots: int) -> pd.DataFrame:
    """Re-price trades from 2020-07 on with 5-minute bars: entry at the close of
    the 09:15 bar (09:20, after the open is known), exit at the close of the
    bar ending 15:15 (MIS square-off). Same picks, real intraday prices."""
    T = T[T.day >= (dt.date(2020, 7, 1) - dt.date(1970, 1, 1)).days].copy()
    rows = []
    for sym, g in T.groupby("symbol"):
        x = load_frame(sym, 5)
        if x is None or x.empty:
            continue
        x, _steps, _ = quality.reconcile(x, load_frame(sym, 1440))
        xd = ist_day(x["time"].to_numpy(dtype=np.int64))
        xm = ist_minute(x["time"].to_numpy(dtype=np.int64))
        for idx, r in g.iterrows():
            b = np.nonzero(xd == r.day)[0]
            if len(b) < 60 or xm[b[0]] != config.SESSION_OPEN:
                continue
            o = float(x["close"].iat[b[0]])
            end = [k for k in b if xm[k] + 5 >= config.SQUAREOFF]
            c = float(x["close"].iat[end[0] if end else b[-1]])
            rows.append((idx, o, c))
    if not rows:
        return T.iloc[0:0]
    R = pd.DataFrame(rows, columns=["idx", "o", "c"]).set_index("idx")
    T = T.loc[R.index].copy()
    es, xs = EXIT_SLIP_BPS / 1e4, EXIT_SLIP_BPS / 1e4
    T["entry"] = R.o * (1 + es * T.side)
    T["exit"] = R.c * (1 - xs * T.side)
    T["qty"] = np.floor(BOOK / slots / T.entry)
    T = T[T.qty > 0]
    ev, xv = T.qty * T.entry, T.qty * T.exit
    T["gross"] = (T.exit - T.entry) * T.qty * T.side
    T["costs"] = trade_costs(ev.to_numpy(), xv.to_numpy(), T.side.to_numpy(), T.day.to_numpy(), True)
    T["net"] = T.gross - T.costs
    return T


# ------------------------------------------------------------ run
def run(final: bool = False, data_version: str | None = None) -> dict:
    t0 = time.time()
    d = load(data_version)
    des = design(d)
    wf = walk_forward(des, final=final)
    pred = wf["pred"]
    p = d["p"]
    hold = (HOLDOUT_FROM - dt.date(1970, 1, 1)).days
    have = np.isfinite(pred).any(axis=1)
    dev_rows = np.nonzero(have & (p.days < hold))[0]
    hold_rows = np.nonzero(have & (p.days >= hold))[0]
    out: dict = {"final": final, "holdout_from": HOLDOUT_FROM.isoformat(), "configs": CONFIGS, "folds": wf["folds"],
                 "features": FEATURES, "hgb": HGB, "entry_slip_bps": ENTRY_SLIP_BPS, "exit_slip_bps": EXIT_SLIP_BPS,
                 "cost_model": COST_MODEL_VERSION, "book": BOOK, "liquid_n": LIQUID_N, "data_version": d["data_version"]}
    for name, rows in (("dev", dev_rows), ("holdout", hold_rows)):
        if not len(rows):
            continue
        seg = {"from": day_to_date(int(p.days[rows[0]])).isoformat(), "to": day_to_date(int(p.days[rows[-1]])).isoformat(),
               "ic": information(des, pred, rows)}
        for cname, cfg in CONFIGS.items():
            T = trades(des, pred, cfg, rows)
            seg[cname] = book_stats(T, int(p.days[rows[0]]), int(p.days[rows[-1]]))
            seg[cname]["cost_x2"] = book_stats(trades(des, pred, cfg, rows, cost_mult=2.0, entry_bps=2 * ENTRY_SLIP_BPS,
                                                      exit_bps=2 * EXIT_SLIP_BPS), int(p.days[rows[0]]), int(p.days[rows[-1]]))["net"]
            if name == "holdout" or (name == "dev" and cname == "ls3"):
                R = replay_5m(T, cfg["long"] + cfg["short"])
                if len(R):
                    seg[cname]["replay_5m"] = book_stats(R, int(R.day.min()), int(R.day.max()))
        out[name] = seg
    # stage 2 (decide at 09:20), on the stage-1 out-of-sample scores
    s2 = stage2(des, pred, final=final)
    out["stage2_folds"] = s2["folds"]
    have2 = np.isfinite(s2["pred"]).any(axis=1)
    for name, rows in (("dev", np.nonzero(have2 & (p.days < hold))[0]), ("holdout", np.nonzero(have2 & (p.days >= hold))[0])):
        if len(rows):
            out[f"stage2_{name}"] = stage2_report(des, s2, pred, rows)
    np.save(config.DATA / f"daytrade_pred2_{'final' if final else 'dev'}.npy", s2["pred"])
    out["elapsed_s"] = round(time.time() - t0)
    with db.tx() as con:
        con.execute("INSERT INTO runs(kind, status, started_at, finished_at, data_version, code_version, params, seed, summary) "
                    "VALUES(?,?,?,?,?,?,?,?,?)",
                    ("daytrade_final" if final else "daytrade_dev", "done", t0, time.time(), d["data_version"],
                     (config.ROOT / "CODE_VERSION").read_text().strip() if (config.ROOT / "CODE_VERSION").exists() else None,
                     json.dumps({"final": final, "configs": CONFIGS, "hgb": HGB}), config.SEED, json.dumps(out, default=str)))
    np.save(config.DATA / f"daytrade_pred_{'final' if final else 'dev'}.npy", pred)
    return out


# ------------------------------------------------------------ stage 2: decide at 09:20
# The daily model's edge is mostly the first five minutes (the opening price
# reverting), which no order placed after the open can take. Stage 2 decides
# at 09:20 instead: it sees the daily model's out-of-sample score and the
# first 5-minute bar, and is trained on what is actually tradeable — the move
# from the 09:20 close to the close of the bar ending 15:15. 5-minute history
# starts 2020-07, so its walk-forward starts later.
S2_FEATURES = ["s1", "s1_raw", "first_ret", "first_rng", "first_relvol", "gap920"] + [f"p_{k}" for k in RANKED] + RAW + MARKET
S2_CONFIGS = {
    "s2_short3": {"long": 0, "short": 3, "hurdle": 0.0},
    "s2_ls3": {"long": 3, "short": 3, "hurdle": 0.0},
    "s2_short5": {"long": 0, "short": 5, "hurdle": 0.0},
}
S2_FIRST_TEST_YEAR = 2022
HGB2 = dict(max_iter=200, learning_rate=0.05, max_leaf_nodes=15, min_samples_leaf=1000, l2_regularization=1.0)


def intraday_panel(p) -> dict[str, np.ndarray]:
    """(D, S) from 5-minute bars, in each stock's own intraday prices: the
    09:15 bar's open/high/low/close/volume, and the close of the bar ending 15:15."""
    D, S = len(p.days), len(p.symbols)
    out = {k: np.full((D, S), np.nan) for k in ("o915", "h915", "l915", "c920", "v915", "c1515")}
    for j, sym in enumerate(p.symbols):
        x = load_frame(sym, 5)
        if x is None or x.empty:
            continue
        x, _steps, _ = quality.reconcile(x, load_frame(sym, 1440))
        xd = ist_day(x["time"].to_numpy(dtype=np.int64))
        xm = ist_minute(x["time"].to_numpy(dtype=np.int64))
        first = xm == config.SESSION_OPEN
        sq = (xm + 5) == config.SQUAREOFF
        f = pd.DataFrame({"day": xd[first], "o": x["open"].to_numpy()[first], "h": x["high"].to_numpy()[first],
                          "l": x["low"].to_numpy()[first], "c": x["close"].to_numpy()[first], "v": x["volume"].to_numpy()[first]})
        e = pd.DataFrame({"day": xd[sq], "c1515": x["close"].to_numpy()[sq]})
        f = f.merge(e, on="day", how="inner")
        di = np.searchsorted(p.days, f["day"].to_numpy())
        ok = (di < D) & (p.days[np.minimum(di, D - 1)] == f["day"].to_numpy())
        for k, col in (("o915", "o"), ("h915", "h"), ("l915", "l"), ("c920", "c"), ("v915", "v"), ("c1515", "c1515")):
            out[k][di[ok], j] = f[col].to_numpy(dtype=float)[ok]
    return out


def stage2(des: dict, pred1: np.ndarray, final: bool = False, seed: int = config.SEED) -> dict:
    p = des["d"]["p"]
    ip = intraday_panel(p)
    with np.errstate(divide="ignore", invalid="ignore"):
        have = des["elig"] & np.isfinite(pred1) & np.isfinite(ip["c920"]) & np.isfinite(ip["c1515"]) & (ip["c920"] > 0)
        have &= np.isfinite(ip["o915"]) & (ip["o915"] > 0) & (ip["h915"] >= ip["l915"])
        first_ret = ip["c920"] / ip["o915"] - 1
        v = pd.DataFrame(ip["v915"])
        feats = {
            "first_ret": first_ret,
            "first_rng": (ip["h915"] - ip["l915"]) / ip["o915"] / des["x"]["atr_pct_raw"],
            "first_relvol": (v / v.shift(1).rolling(20, min_periods=10).mean()).to_numpy(),
            "gap920": (1 + des["x"]["gap_raw"]) * (1 + first_ret) - 1,
        }
        y = ip["c1515"] / ip["c920"] - 1
    y = np.where(have, y, np.nan)
    with np.errstate(invalid="ignore"):
        y_dm = np.clip(y - np.nanmean(y, axis=1, keepdims=True), -LABEL_CLIP, LABEL_CLIP)
    s1 = _pct(pd.DataFrame(pred1), have)
    cols = {"s1": s1, "s1_raw": pred1}
    cols.update({k: _pct(pd.DataFrame(v_), have) if k != "first_ret" else v_ for k, v_ in feats.items()})
    cols["first_ret_p"] = _pct(pd.DataFrame(first_ret), have)

    def X(rows):
        e = have[rows]
        ii, jj = np.nonzero(e)
        r = rows[ii]
        mats = [cols[k][r, jj] for k in ("s1", "s1_raw", "first_ret", "first_rng", "first_relvol", "gap920")]
        mats += [des["x"][f"p_{k}"][r, jj] for k in RANKED] + [des["x"][k][r, jj] for k in RAW] + [des["m"][k][r] for k in MARKET]
        return np.column_stack(mats).astype(np.float32), ii, jj

    years = np.array([day_to_date(int(x)).year for x in p.days])
    rows_ok = have.any(axis=1)
    pred2 = np.full(y.shape, np.nan, dtype=np.float32)
    folds = []
    for Y in range(S2_FIRST_TEST_YEAR, int(years[-1]) + 1):
        if not final and Y >= HOLDOUT_FROM.year:
            break
        train = np.nonzero(rows_ok & (years < Y))[0]
        test = np.nonzero(rows_ok & (years == Y))[0]
        if not len(test) or not len(train):
            continue
        Xtr, ii, jj = X(train)
        yv = y_dm[train[ii], jj]
        m = np.isfinite(yv)
        model = HistGradientBoostingRegressor(**HGB2, early_stopping=False, random_state=seed).fit(Xtr[m], yv[m])
        Xt, it, jt = X(test)
        pred2[test[it], jt] = model.predict(Xt)
        folds.append({"year": Y, "train_rows": int(m.sum()), "test_sessions": int(len(test))})
        log(f"stage2 fold {Y}: {int(m.sum())} train rows, {len(test)} sessions")
    return {"pred": pred2, "ip": ip, "have": have, "y": y, "folds": folds}


def trades920(des: dict, s2: dict, pred: np.ndarray, cfg: dict, rows: np.ndarray, slip_bps: float = EXIT_SLIP_BPS,
              cost_mult: float = 1.0) -> pd.DataFrame:
    """Positions the rule takes: entry at the 09:20 close, exit at the 15:15 close (5-minute bars)."""
    p = des["d"]["p"]
    ip = s2["ip"]
    slot = BOOK / (cfg["long"] + cfg["short"])
    sl = slip_bps / 1e4
    out = []
    for t in rows:
        sc = np.where(s2["have"][t] & np.isfinite(pred[t]), pred[t], np.nan)
        ok = np.nonzero(np.isfinite(sc))[0]
        if len(ok) < MIN_NAMES:
            continue
        order = ok[np.argsort(-sc[ok], kind="stable")]
        picks = [(j, 1) for j in order[: cfg["long"]]] + [(j, -1) for j in order[::-1][: cfg["short"]]]
        for j, side in picks:
            epx = ip["c920"][t, j] * (1 + sl * side)
            xpx = ip["c1515"][t, j] * (1 - sl * side)
            q = math.floor(slot / epx)
            if q > 0:
                out.append((int(p.days[t]), p.symbols[j], side, q, epx, xpx, float(sc[j])))
    T = pd.DataFrame(out, columns=["day", "symbol", "side", "qty", "entry", "exit", "score"])
    if T.empty:
        return T.assign(gross=[], costs=[], net=[])
    ev, xv = T.qty * T.entry, T.qty * T.exit
    T["gross"] = (T.exit - T.entry) * T.qty * T.side
    T["costs"] = trade_costs(ev.to_numpy(), xv.to_numpy(), T.side.to_numpy(), T.day.to_numpy(), True) * cost_mult
    T["net"] = T.gross - T.costs
    return T


def stage2_report(des: dict, s2: dict, pred1: np.ndarray, rows: np.ndarray) -> dict:
    p = des["d"]["p"]
    out = {"from": day_to_date(int(p.days[rows[0]])).isoformat(), "to": day_to_date(int(p.days[rows[-1]])).isoformat()}
    for name, pred in (("stage2", s2["pred"]), ("stage1_at_0920", pred1)):
        ics = []
        for t in rows:
            m = s2["have"][t] & np.isfinite(pred[t]) & np.isfinite(s2["y"][t])
            if m.sum() >= MIN_NAMES:
                ics.append(pd.Series(pred[t][m]).corr(pd.Series(s2["y"][t][m]), method="spearman"))
        ics = np.array([x for x in ics if np.isfinite(x)])
        res = {"ic_mean": float(ics.mean()) if len(ics) else None,
               "ic_t": float(ics.mean() / ics.std(ddof=1) * math.sqrt(len(ics))) if len(ics) > 2 else None}
        for cname, cfg in S2_CONFIGS.items():
            T = trades920(des, s2, pred, cfg, rows)
            if len(T):
                res[cname] = book_stats(T, int(p.days[rows[0]]), int(p.days[rows[-1]]))
                res[cname]["gross_bps"] = float((T.gross / (T.qty * T.entry)).mean() * 1e4)
                res[cname]["cost_x2"] = float(trades920(des, s2, pred, cfg, rows, slip_bps=2 * EXIT_SLIP_BPS, cost_mult=2.0).net.sum())
        out[name] = res
    return out
