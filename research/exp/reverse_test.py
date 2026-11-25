"""Stop-and-reverse on the live rule (ENS3 K=1 short, count2 regime skip, 0.5% market stop, 10:15 flip): when the short
is X% against, cover and (a) stay flat, (b) go long the SAME stock to 15:15, (c) go long the top gainer so far.
2023-01..2026-04 = dev, 2026-05..2026-10 = sealed. Rs 5L, all costs, tick-aware slippage."""
import sys, math, numpy as np, pandas as pd
from pathlib import Path
HERE = Path(__file__).resolve().parent; sys.path.insert(0, str(HERE))
import prep
from mnha_research import lab
from mnha_research.costs import trade_costs
L = lab.load(final=True); inp = prep.load(L, verbose=False)
score = inp["book_ens3"]; reg = prep.regime(L); skip = dict(zip(reg["days"], reg["count2"]))
days = L.df.day.to_numpy(); C, H, Lw = L.c, L.h, L.l
BOOK = 5e5; NB = 72; MSTOP = 0.005; FB = 11; FTHR = 0.0025
D0 = (pd.Timestamp("2023-01-01") - pd.Timestamp("1970-01-01")).days
SEAL = (pd.Timestamp("2026-05-01") - pd.Timestamp("1970-01-01")).days
NOV = (pd.Timestamp("2026-11-01") - pd.Timestamp("1970-01-01")).days

def slip(px, day): return max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([px]), np.array([day]))[0]) / px)
def leg(side, e, x, q, day):
    gross = (x - e) * q * side
    return gross - float(trade_costs(np.array([e * q]), np.array([x * q]), np.array([side]), np.array([day]), True)[0])

VARS = [("live rule", None, None)] + [(f"{m} {x * 100:g}%", m, x) for x in (0.005, 0.0075, 0.01, 0.015, 0.02) for m in ("cover", "reverse same", "reverse gainer")]
out = {v[0]: {} for v in VARS}; nrev = {v[0]: 0 for v in VARS}; nd = 0
for day in np.unique(days[days >= D0]):
    if day >= NOV or skip.get(day, False): continue
    idx = np.flatnonzero(days == day); sc = score[idx]
    ok = np.isfinite(sc)
    if ok.sum() < 20: continue
    pick = idx[ok][np.argmin(sc[ok])]
    c0 = C[idx, 0]; good = c0 > 0
    rel = C[idx][good] / c0[good, None] - 1
    mkt = rel.mean(axis=0); med11 = float(np.median(rel[:, FB])); flip_on = med11 >= FTHR
    g11 = idx[good][np.argmax(rel[:, FB])]
    nd += 1
    s0 = slip(C[pick, 0], day); e = C[pick, 0] * (1 - s0); q = math.floor(BOOK / e)
    for name, mode, X in VARS:
        pnl = 0.0; done = False
        for b in range(1, NB):
            if mode is not None and H[pick, b] >= e * (1 + X):
                xs = e * (1 + X) * (1 + s0); pnl += leg(-1, e, xs, q, day); nrev[name] += 1
                if mode != "cover":
                    gr = pick if mode == "reverse same" else idx[good][np.argmax(rel[:, b])]
                    s2 = slip(C[gr, b], day); e2 = C[gr, b] * (1 + s2); q2 = math.floor(BOOK / e2)
                    pnl += leg(1, e2, C[gr, NB - 1] * (1 - s2), q2, day)
                done = True; break
            if b <= NB - 2 and mkt[b] >= MSTOP:
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day); done = True; break
            if flip_on and b == FB:
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day)
                s2 = slip(C[g11, b], day); e2 = C[g11, b] * (1 + s2); q2 = math.floor(BOOK / e2)
                pnl += leg(1, e2, C[g11, NB - 1] * (1 - s2), q2, day); done = True; break
        if not done: pnl += leg(-1, e, C[pick, NB - 1] * (1 + s0), q, day)
        out[name][day] = pnl
print(f"{nd} sessions traded (regime skips removed), 2023-01..2026-10")
print(f"{'variant':20s} {'dev %/mo':>9s} {'worst mo':>9s} {'mo+':>5s} {'seal %/mo':>10s} {'seal worst':>10s} {'days rev':>9s}")
for name, _, _ in VARS:
    s = pd.Series(out[name]); m = s.groupby(pd.to_datetime(s.index, unit="D").to_period("M")).sum() / BOOK * 100
    dev = m[m.index < pd.Period("2026-05")]; seal = m[m.index >= pd.Period("2026-05")]
    print(f"{name:20s} {dev.mean():+8.2f}% {dev.min():+8.1f}% {(dev > 0).mean():4.0%} {seal.mean():+9.2f}% {seal.min():+9.1f}% {nrev[name] / nd:8.0%}")
