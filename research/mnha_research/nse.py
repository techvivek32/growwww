"""Daily NSE files the models read as information (nothing is traded in F&O).

* Delivery share: the security-wise delivery file (MTO), traded vs delivered quantity of every EQ series stock.
* Open interest: the F&O bhavcopy, summed per underlying.
  * Stock-futures OI and volume.
  * Call and put OI.

`update()` fetches every weekday after the last stored session, up to the given day. It appends to
`data/nse/delivery.parquet` (symbol, day, share) and `data/nse/fo_oi.parquet` (symbol, day, fut_oi, fut_vol,
ce_oi, pe_oi), under today's tickers. This is the same packing as the original 2010-onward history.

A day NSE does not publish (a holiday) is skipped. A network failure stops the run, and the next run resumes.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import os
import time
import zipfile

import pandas as pd
import requests

from . import config, pit

try:
    import fcntl
except ImportError:  # not Linux: a development machine, no timer writing beside us
    fcntl = None

DIR = config.DATA / "nse"
DELIVERY = DIR / "delivery.parquet"
FO_OI = DIR / "fo_oi.parquet"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
NEW_FO_FROM = dt.date(2024, 7, 8)  # the UDiFF bhavcopy format
ALIASES = {"L&T": "LT", "COLGATE": "COLPAL", "NIIT": "NIITLTD", "RUCHISOYA": "PATANJALI"}
EPOCH = dt.date(1970, 1, 1)


class NseUnavailable(RuntimeError):
    pass


def _get(url: str, session: requests.Session) -> bytes | None:
    """The file, None if NSE has none for that day (404); raises after retries."""
    last = None
    for attempt in range(3):
        try:
            r = session.get(url, headers={"User-Agent": UA, "Referer": "https://www.nseindia.com/"}, timeout=40)
            if r.status_code == 404:
                return None
            if r.status_code == 200 and r.content:
                return r.content
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(4 * (attempt + 1))
    raise NseUnavailable(f"{url}: {last}")


def mto(d: dt.date, session: requests.Session) -> list[tuple[str, float, float]] | None:
    """[(symbol, traded qty, delivered qty)] of EQ series stocks; None on a holiday."""
    data = _get(f"https://nsearchives.nseindia.com/archives/equities/mto/MTO_{d:%d%m%Y}.DAT", session)
    if data is None:
        return None
    out = []
    for line in data.decode("latin-1").splitlines():
        p = line.split(",")
        if len(p) >= 7 and p[0] == "20" and p[3].strip() == "EQ":
            try:
                out.append((p[2].strip(), float(p[4]), float(p[5])))
            except ValueError:
                pass
    return out


def _fo_csv(d: dt.date, session: requests.Session) -> str | None:
    """The day's F&O bhavcopy as CSV text; None on a holiday."""
    if d >= NEW_FO_FROM:
        url = f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"
    else:
        mon = d.strftime("%b").upper()
        url = f"https://nsearchives.nseindia.com/content/historical/DERIVATIVES/{d.year}/{mon}/fo{d:%d}{mon}{d.year}bhav.csv.zip"
    data = _get(url, session)
    if data is None:
        return None
    z = zipfile.ZipFile(io.BytesIO(data))
    return z.read(z.namelist()[0]).decode("utf-8", "replace")


def futures(d: dt.date, text: str) -> list[str]:
    """Underlyings with stock futures in a bhavcopy, under the tickers of that day."""
    new = d >= NEW_FO_FROM
    out: set[str] = set()
    for row in csv.DictReader(io.StringIO(text)):
        t = row.get("FinInstrmTp") if new else (row.get("INSTRUMENT") or "").strip()
        sym = ((row.get("TckrSymb") if new else row.get("SYMBOL")) or "").strip()
        if sym and t == ("STF" if new else "FUTSTK"):
            out.add(sym)
    return sorted(out)


def fo(d: dt.date, session: requests.Session) -> dict[str, list[float]] | None:
    """{underlying: [futures OI, futures volume, call OI, put OI]}; None on a holiday."""
    text = _fo_csv(d, session)
    if text is None:
        return None
    agg: dict[str, list[float]] = {}
    for row in csv.DictReader(io.StringIO(text)):
        if d >= NEW_FO_FROM:
            t, sym, opt = row.get("FinInstrmTp"), (row.get("TckrSymb") or "").strip(), row.get("OptnTp")
            kind = "F" if t == "STF" else ("C" if t == "STO" and opt == "CE" else ("P" if t == "STO" and opt == "PE" else None))
            oi, vol = row.get("OpnIntrst") or 0, row.get("TtlTradgVol") or 0
        else:
            t, sym, opt = (row.get("INSTRUMENT") or "").strip(), (row.get("SYMBOL") or "").strip(), row.get("OPTION_TYP")
            kind = "F" if t == "FUTSTK" else ("C" if t == "OPTSTK" and opt == "CE" else ("P" if t == "OPTSTK" and opt == "PE" else None))
            oi, vol = row.get("OPEN_INT") or 0, row.get("CONTRACTS") or 0
        if not kind:
            continue
        try:
            oi, vol = float(oi), float(vol)
        except ValueError:
            continue
        a = agg.setdefault(sym, [0.0, 0.0, 0.0, 0.0])
        if kind == "F":
            a[0] += oi
            a[1] += vol
        elif kind == "C":
            a[2] += oi
        else:
            a[3] += oi
    return agg


def _names() -> dict[str, str]:
    names = pit.symbol_map()
    for o, n in ALIASES.items():
        names.setdefault(o, n)
    return names


def _keep(names: dict[str, str]) -> set[str]:
    """Stocks that ever had F&O, under today's tickers (the history kept the same set)."""
    keep: set[str] = set()
    for _d, members in pit.snapshots():
        keep |= {names.get(s, s) for s in members}
    return keep


def _append(path, new: pd.DataFrame) -> int:
    if new.empty:
        return 0
    with open(path.with_name(path.name + ".lock"), "w") as lock:  # nse-history and the morning update may overlap
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX)
        old = pd.read_parquet(path) if path.exists() else new.iloc[0:0]
        out = pd.concat([old, new], ignore_index=True).drop_duplicates(["symbol", "day"], keep="last")
        out = out.sort_values(["day", "symbol"]).reset_index(drop=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        out.to_parquet(tmp, index=False)
        tmp.replace(path)
    return len(new)


def last_day(path) -> int | None:
    if not path.exists():
        return None
    return int(pd.read_parquet(path, columns=["day"])["day"].max())


def _fetch(kind: str, d: dt.date, upto: dt.date, names: dict[str, str], keep: set[str], session: requests.Session,
           out: dict, rows: list[dict]) -> None:
    """Append the `kind` rows of every weekday d..upto to `rows`. NseUnavailable propagates; the rows so far stay."""
    while d <= upto:
        if d.weekday() < 5:
            day = (d - EPOCH).days
            if kind == "delivery":
                got = mto(d, session)
                if got is None:
                    out["holidays"].append(d.isoformat())
                else:
                    best: dict[str, tuple[float, float]] = {}
                    for sym, tq, dq in got:
                        s = names.get(sym, sym)
                        if s in keep and tq > 0 and 0 <= dq <= tq and (s not in best or tq > best[s][0]):
                            best[s] = (tq, dq / tq)
                    rows += [{"symbol": s, "day": day, "share": round(sh, 5)} for s, (_tq, sh) in best.items()]
                    out["delivery_days"] += 1
            else:
                got = fo(d, session)
                if got is None:
                    out["holidays"].append(d.isoformat())
                else:
                    best2: dict[str, list[float]] = {}
                    for sym, v in got.items():
                        s = names.get(sym, sym)
                        if s not in best2 or v[0] > best2[s][0]:
                            best2[s] = v
                    rows += [{"symbol": s, "day": day, "fut_oi": int(v[0]), "fut_vol": int(v[1]), "ce_oi": int(v[2]),
                              "pe_oi": int(v[3])} for s, v in best2.items()]
                    out["fo_days"] += 1
            time.sleep(0.5)
        d += dt.timedelta(days=1)


def update(upto: dt.date | None = None, max_days: int = 30) -> dict:
    """Fetch and append every missing weekday after the last stored session, up to `upto` (default: yesterday IST)."""
    DIR.mkdir(parents=True, exist_ok=True)
    today_ist = dt.datetime.fromtimestamp(time.time() + config.IST_OFFSET_S, dt.timezone.utc).date()
    upto = upto or (today_ist - dt.timedelta(days=1))
    names = _names()
    keep = _keep(names)
    session = requests.Session()
    out = {"delivery_days": 0, "fo_days": 0, "holidays": [], "error": None}
    for path, kind in ((DELIVERY, "delivery"), (FO_OI, "fo")):
        last = last_day(path)
        d = (EPOCH + dt.timedelta(days=last + 1)) if last is not None else upto
        if (upto - d).days > max_days:
            d = upto - dt.timedelta(days=max_days)
        rows: list[dict] = []
        try:
            _fetch(kind, d, upto, names, keep, session, out, rows)
        except NseUnavailable as e:
            out["error"] = str(e)[:300]
        _append(path, pd.DataFrame(rows))
    out["holidays"] = sorted(set(out["holidays"]))
    out["delivery_last"] = last_day(DELIVERY)
    out["fo_last"] = last_day(FO_OI)
    return out


# ------------------------------------------------------------ history (a new host)
MEMBERSHIP_FROM = dt.date(2003, 1, 1)
HISTORY_FROM = dt.date(2010, 1, 1)
SYMBOL_CHANGES_URL = "https://nsearchives.nseindia.com/content/equities/symbolchange.csv"
PROGRESS = DIR / "history.json"


def _write(path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def history(upto: dt.date | None = None) -> dict:
    """Build data/nse from NSE's archives, for a host that can reach them: the symbol changes, the F&O membership
    (the bhavcopy of the first session of every month since MEMBERSHIP_FROM) and the daily delivery share and open
    interest since HISTORY_FROM, packed as `update` packs them. Resumable: finished months and years are skipped.
    Until it finishes cleanly, `building()` is true and no stage-1 score is computed on the partial files."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    DIR.mkdir(parents=True, exist_ok=True)
    today_ist = dt.datetime.fromtimestamp(time.time() + config.IST_OFFSET_S, dt.timezone.utc).date()
    upto = upto or (today_ist - dt.timedelta(days=1))
    session = requests.Session()
    out: dict = {}

    data = _get(SYMBOL_CHANGES_URL, session)
    if data:
        _write(pit.SYMBOL_CHANGES, data)
    out["symbol_changes"] = len(pit.symbol_map())

    progress: dict = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    _write(PROGRESS, json.dumps({**progress, "complete": False}).encode())
    members: dict[str, list[str]] = json.loads(pit.MEMBERSHIP.read_text()) if pit.MEMBERSHIP.exists() else {}
    have = {k[:7] for k in members}
    m = MEMBERSHIP_FROM
    while m <= upto:
        if f"{m:%Y-%m}" not in have:
            d = m
            while d.month == m.month and d <= upto:
                if d.weekday() < 5:
                    text = _fo_csv(d, session)
                    time.sleep(0.5)
                    if text is not None:
                        members[d.isoformat()] = futures(d, text)
                        _write(pit.MEMBERSHIP, json.dumps(dict(sorted(members.items()))).encode())
                        break
                d += dt.timedelta(days=1)
        m = dt.date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    out["membership_months"] = len(members)
    print(f"nse history: {len(members)} monthly F&O lists, {out['symbol_changes']} symbol changes", flush=True)

    names = _names()
    keep = _keep(names)
    done: dict = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    done["complete"] = False
    _write(PROGRESS, json.dumps(done).encode())
    lock = threading.Lock()

    def one(path, kind: str) -> dict:
        s = requests.Session()
        res = {"delivery_days": 0, "fo_days": 0, "holidays": [], "error": None}
        for Y in range(HISTORY_FROM.year, upto.year + 1):
            if done.get(kind, 0) >= Y:
                continue
            rows: list[dict] = []
            try:
                _fetch(kind, max(dt.date(Y, 1, 1), HISTORY_FROM), min(dt.date(Y, 12, 31), upto), names, keep, s, res, rows)
            except NseUnavailable as e:
                res["error"] = str(e)[:300]
            _append(path, pd.DataFrame(rows))
            if res["error"]:
                break
            if Y < upto.year:
                with lock:
                    done[kind] = Y
                    _write(PROGRESS, json.dumps(done).encode())
            print(f"nse history: {kind} {Y} done ({len(rows)} rows)", flush=True)
        res["holidays"] = len(set(res["holidays"]))
        return res

    with ThreadPoolExecutor(2) as ex:
        jobs = {kind: ex.submit(one, path, kind) for path, kind in ((DELIVERY, "delivery"), (FO_OI, "fo"))}
        for kind, job in jobs.items():
            out[kind] = job.result()
    if not (out["delivery"]["error"] or out["fo"]["error"]):
        with lock:
            done["complete"] = True
            _write(PROGRESS, json.dumps(done).encode())
    out["complete"] = bool(done["complete"])
    out["delivery_last"] = last_day(DELIVERY)
    out["fo_last"] = last_day(FO_OI)
    return out


def building() -> bool:
    """True while nse-history has started on this host and not finished cleanly."""
    try:
        return json.loads(PROGRESS.read_text()).get("complete") is False
    except (OSError, ValueError):
        return False
