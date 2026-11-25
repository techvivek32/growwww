"""The admin's rule for Book A: when the short is losing and the stock is going up, switch to a long of the same stock.
Which trigger hurts least? Loss level X, the stock above VWAP, optional market condition; long held to 15:15 with a
trailing stop or not. 2023-01..2026-04 dev, 2026-05..10 sealed, Rs 5L, all costs."""
import sys, math, numpy as np, pandas as pd
from pathlib import Path
HERE = Path(__file__).resolve().parent; sys.path.insert(0, str(HERE))
import prep
from mnha_research import lab
from mnha_research.costs import trade_costs
L = lab.load(final=True); inp = prep.load(L, verbose=False)
score = inp["book_ens3"]; reg = prep.regime(L); skip = dict(zip(reg["days"], reg["count2"]))
days = L.df.day.to_numpy(); O, C, H, Lw, V = L.o, L.c, L.h, L.l, L.v
BOOK = 5e5; NB = 72; MSTOP = 0.005; FB = 11; FTHR = 0.0025
D0 = (pd.Timestamp("2023-01-01") - pd.Timestamp("1970-01-01")).days
NOV = (pd.Timestamp("2026-11-01") - pd.Timestamp("1970-01-01")).days
def slip(px, day): return max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([px]), np.array([day]))[0]) / px)
def leg(side, e, x, q, day):
    return (x - e) * q * side - float(trade_costs(np.array([e * q]), np.array([x * q]), np.array([side]), np.array([day]), True)[0])
VARS = {"live rule": None}
for X in (0.01, 0.015, 0.02):
    for cond in ("any", "vwap", "vwap+mkt>=0"):
        for trail in (0.0, 0.01):
            VARS[f"X={X*100:g}% {cond}{' trail1%' if trail else ''}"] = (X, cond, trail)
out = {k: {} for k in VARS}; nrev = {k: 0 for k in VARS}; nd = 0
for day in np.unique(days[days >= D0]):
    if day >= NOV or skip.get(day, False): continue
    idx = np.flatnonzero(days == day); sc = score[idx]; ok = np.isfinite(sc)
    if ok.sum() < 20: continue
    pick = idx[ok][np.argmin(sc[ok])]
    c0 = C[idx, 0]; good = c0 > 0; rel = C[idx][good] / c0[good, None] - 1
    mkt = rel.mean(axis=0); flip_on = float(np.median(rel[:, FB])) >= FTHR; g11 = idx[good][np.argmax(rel[:, FB])]
    tp = (H[pick] + Lw[pick] + C[pick]) / 3; vwap = np.cumsum(tp * V[pick]) / np.maximum(np.cumsum(V[pick]), 1)
    s0 = slip(C[pick, 0], day); e = C[pick, 0] * (1 - s0); q = math.floor(BOOK / e); nd += 1
    for name, v in VARS.items():
        pnl = 0.0; done = False
        for b in range(1, NB - 1):
            if v is not None:
                X, cond, trail = v
                trig = C[pick, b] >= e * (1 + X) and (cond == "any" or C[pick, b] > vwap[b]) and (cond != "vwap+mkt>=0" or mkt[b] >= 0)
                if trig:
                    pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day); nrev[name] += 1
                    e2 = C[pick, b] * (1 + s0); q2 = math.floor(BOOK / e2); x2 = C[pick, NB - 1] * (1 - s0)
                    if trail:
                        best = e2
                        for bb in range(b + 1, NB):
                            best = max(best, H[pick, bb])
                            if Lw[pick, bb] <= best * (1 - trail):
                                x2 = best * (1 - trail) * (1 - s0); break
                    pnl += leg(1, e2, x2, q2, day); done = True; break
            if mkt[b] >= MSTOP:
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day); done = True; break
            if flip_on and b == FB:
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day)
                s2 = slip(C[g11, b], day); e2 = C[g11, b] * (1 + s2); q2 = math.floor(BOOK / e2)
                pnl += leg(1, e2, C[g11, NB - 1] * (1 - s2), q2, day); done = True; break
        if not done: pnl += leg(-1, e, C[pick, NB - 1] * (1 + s0), q, day)
        out[name][day] = pnl
print(f"{nd} sessions")
print(f"{'variant':28s} {'dev %/mo':>9s} {'worst':>7s} {'seal %/mo':>10s} {'seal worst':>10s} {'days':>5s}")
for name in VARS:
    s = pd.Series(out[name]); m = s.groupby(pd.to_datetime(s.index, unit="D").to_period("M")).sum() / BOOK * 100
    dev = m[m.index < pd.Period("2026-05")]; seal = m[m.index >= pd.Period("2026-05")]
    print(f"{name:28s} {dev.mean():+8.2f}% {dev.min():+6.1f}% {seal.mean():+9.2f}% {seal.min():+9.1f}% {nrev[name] / nd:5.0%}")
