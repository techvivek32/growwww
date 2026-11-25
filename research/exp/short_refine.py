"""Refinements of the live short rule aimed at protecting the Rs 5L book: profit lock, take-profit, time stop, entry
confirmation, 2% cover, half size, monthly circuit breaker, and the combination. 2023-01..2026-04 dev, 2026-05..10 sealed."""
import sys, math, numpy as np, pandas as pd
from pathlib import Path
HERE = Path(__file__).resolve().parent; sys.path.insert(0, str(HERE))
import prep
from mnha_research import lab
from mnha_research.costs import trade_costs
L = lab.load(final=True); inp = prep.load(L, verbose=False)
score = inp["book_ens3"]; reg = prep.regime(L); skip = dict(zip(reg["days"], reg["count2"]))
days = L.df.day.to_numpy(); O, C, H, Lw = L.o, L.c, L.h, L.l
BOOK = 5e5; NB = 72; MSTOP = 0.005; FB = 11; FTHR = 0.0025
D0 = (pd.Timestamp("2023-01-01") - pd.Timestamp("1970-01-01")).days
NOV = (pd.Timestamp("2026-11-01") - pd.Timestamp("1970-01-01")).days

def slip(px, day): return max(lab.SLIP_BPS / 1e4, 0.5 * float(lab.tick_size(np.array([px]), np.array([day]))[0]) / px)
def leg(side, e, x, q, day):
    return (x - e) * q * side - float(trade_costs(np.array([e * q]), np.array([x * q]), np.array([side]), np.array([day]), True)[0])

VARS = {
    "live rule": {},
    "cover at 2%": dict(cover=0.02),
    "profit lock: +1.5% then trail 0.75%": dict(lock=(0.015, 0.0075)),
    "take profit 3%": dict(tp=0.03),
    "time stop: 11:00 if losing 0.5%+": dict(tstop=(20, 0.005)),
    "entry only if first bar red": dict(red=True),
    "half size (Rs 2.5L)": dict(size=0.5),
    "circuit breaker: month -6% stops": dict(cb=0.06),
    "combo: 2% cover + lock + breaker": dict(cover=0.02, lock=(0.015, 0.0075), cb=0.06),
    "combo + half size": dict(cover=0.02, lock=(0.015, 0.0075), cb=0.06, size=0.5),
}
out = {k: {} for k in VARS}
for day in np.unique(days[days >= D0]):
    if day >= NOV or skip.get(day, False): continue
    idx = np.flatnonzero(days == day); sc = score[idx]; ok = np.isfinite(sc)
    if ok.sum() < 20: continue
    pick = idx[ok][np.argmin(sc[ok])]
    c0 = C[idx, 0]; good = c0 > 0; rel = C[idx][good] / c0[good, None] - 1
    mkt = rel.mean(axis=0); flip_on = float(np.median(rel[:, FB])) >= FTHR; g11 = idx[good][np.argmax(rel[:, FB])]
    s0 = slip(C[pick, 0], day); e = C[pick, 0] * (1 - s0)
    for name, v in VARS.items():
        pnl = 0.0
        if v.get("red") and C[pick, 0] > O[pick, 0]:
            out[name][day] = 0.0; continue
        q = math.floor(BOOK * v.get("size", 1.0) / e)
        best = e; done = False
        for b in range(1, NB):
            if "cover" in v and H[pick, b] >= e * (1 + v["cover"]):
                pnl += leg(-1, e, e * (1 + v["cover"]) * (1 + s0), q, day); done = True; break
            if "tp" in v and Lw[pick, b] <= e * (1 - v["tp"]):
                pnl += leg(-1, e, e * (1 - v["tp"]) * (1 + s0), q, day); done = True; break
            if "lock" in v:
                best = min(best, Lw[pick, b])
                if best <= e * (1 - v["lock"][0]) and H[pick, b] >= best * (1 + v["lock"][1]):
                    pnl += leg(-1, e, best * (1 + v["lock"][1]) * (1 + s0), q, day); done = True; break
            if "tstop" in v and b == v["tstop"][0] and C[pick, b] >= e * (1 + v["tstop"][1]):
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day); done = True; break
            if b <= NB - 2 and mkt[b] >= MSTOP:
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day); done = True; break
            if flip_on and b == FB:
                pnl += leg(-1, e, C[pick, b] * (1 + s0), q, day)
                s2 = slip(C[g11, b], day); e2 = C[g11, b] * (1 + s2); q2 = math.floor(BOOK * v.get("size", 1.0) / e2)
                pnl += leg(1, e2, C[g11, NB - 1] * (1 - s2), q2, day); done = True; break
        if not done: pnl += leg(-1, e, C[pick, NB - 1] * (1 + s0), q, day)
        out[name][day] = pnl
print(f"{'variant':38s} {'dev %/mo':>9s} {'worst mo':>9s} {'mo+':>5s} {'maxDD Rs':>9s} {'seal %/mo':>10s} {'seal worst':>10s}")
for name, v in VARS.items():
    s = pd.Series(out[name]).sort_index()
    if "cb" in v:  # monthly circuit breaker: once the month is down cb of the book, no more trades that month
        per = pd.to_datetime(s.index, unit="D").to_period("M"); z = s.copy(); run = {}
        for d_, p_ in zip(s.index, per):
            if run.get(p_, 0.0) <= -v["cb"] * BOOK: z[d_] = 0.0
            else: run[p_] = run.get(p_, 0.0) + s[d_]
        s = z
    m = s.groupby(pd.to_datetime(s.index, unit="D").to_period("M")).sum() / BOOK * 100
    dev = m[m.index < pd.Period("2026-05")]; seal = m[m.index >= pd.Period("2026-05")]
    eq = s[pd.to_datetime(s.index, unit="D") < "2026-05-01"].cumsum(); dd = float((eq - eq.cummax()).min())
    print(f"{name:38s} {dev.mean():+8.2f}% {dev.min():+8.1f}% {(dev > 0).mean():4.0%} {dd:9.0f} {seal.mean():+9.2f}% {seal.min():+9.1f}%")
