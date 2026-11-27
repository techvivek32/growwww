"""The NEWS paper book: company news published before the open → paper trades. NO ORDER IS EVER SENT FROM HERE.

09:14 IST (timer mnha-news, Mon-Fri):
  - Read every Business Today story whose sitemap time (lastmod) falls after the previous session's 15:30 and at or before
    09:15 today. lastmod is at or after publication, so nothing published after the open slips in.
  - Link each headline to the liquid F&O stocks Book A trades (news_terms.ALIASES) and score it good / bad by its words.
    A story naming more than 3 stocks ("stocks to watch" lists) counts as a mention only, not for good / bad.
09:20, once the session's first bar exists (no trade on a holiday): open paper trades in book "news":
  - BUY up to 3 good-news stocks and SHORT up to 3 bad-news stocks, ₹5L / 3 each;
  - 1% stop, out on a 0.5% NIFTY move against, square-off 15:15. manual.watch runs these exits.
The book is visible on the admin's paper page with the other paper trades. The website's executor serves only the
"active" book to real accounts (livex.active_today), so these trades never reach a real account.
The rule is under test in the lab (exp/news, pre-registered 27 Nov 2026). It stays paper-only unless it passes there and on paper.
The owner chose this source on 27 Nov 2026: businesstoday.in/markets/stocks. Its robots.txt allows the sitemaps read here."""

from __future__ import annotations

import datetime as dt
import json
import re
import time
import urllib.request

from . import config, live, manual
from .news_terms import ALIASES, EXCL, score
from .validation import day_to_date

SITEMAP = "https://www.businesstoday.in/rssfeeds/date-wise-story-sitemap.xml?yyyy={y}&mm={m:02d}&dd={d:02d}"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
OUT = config.DATA / "news_today.json"
LOG = config.DATA / "news.log"
K = 3  # names per side
SLOT = manual.BOOK / K
MAX_SYMS = 3  # a story naming more stocks than this is a list, not news about one company
STOP = 0.01
_PATS = [(s, ["-" + p + "-" for p in ps], ["-" + e + "-" for e in EXCL.get(s, [])]) for s, ps in ALIASES.items()]


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(time.time() + config.IST_OFFSET_S))} IST] {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def parse_sitemap(xml: str) -> list[tuple[str, str]]:
    """[(lastmod 'YYYY-MM-DDTHH:MM:SS' IST, url)] of one date-wise sitemap."""
    out = []
    for u in re.findall(r"<url>(.*?)</url>", xml, re.S):
        loc = re.search(r"<loc>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*</loc>", u, re.S)
        lm = re.search(r"<lastmod>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*</lastmod>", u, re.S)
        if loc and lm and lm.group(1)[:19]:
            out.append((lm.group(1)[:19], loc.group(1)))
    return out


def fetch_day(d: dt.date, tries: int = 4) -> list[tuple[str, str]]:
    url = SITEMAP.format(y=d.year, m=d.month, d=d.day)
    err = None
    for i in range(tries):
        try:
            xml = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read().decode("utf-8", "ignore")
            return parse_sitemap(xml)
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"Business Today sitemap {d} unreadable: {err}")


def slug_of(url: str) -> str:
    return re.sub(r"-\d+-\d{4}-\d{2}-\d{2}$", "", url.rstrip("/").rsplit("/", 1)[-1].lower())


def link(slug: str) -> list[str]:
    s = "-" + slug + "-"
    return [sym for sym, ps, ex in _PATS if any(p in s for p in ps) and not any(e in s for e in ex)]


def stories(lo: str, hi: str, fetch=fetch_day) -> list[dict]:
    """Stories with lo < lastmod <= hi (IST, 'YYYY-MM-DDTHH:MM:SS'), each with its slug and linked stocks."""
    d, last = dt.date.fromisoformat(lo[:10]), dt.date.fromisoformat(hi[:10])
    seen, out = set(), []
    while d <= last:
        for lm, url in fetch(d):
            if "/story/" not in url or url in seen or not (lo < lm <= hi):
                continue
            seen.add(url)
            slug = slug_of(url)
            out.append({"at": lm, "url": url, "slug": slug, "stocks": link(slug), "score": score(slug)})
        d += dt.timedelta(days=1)
    return sorted(out, key=lambda r: r["at"])


def signals(st: list[dict]) -> dict[str, dict]:
    """Per stock: stories, summed score (only stories naming at most MAX_SYMS stocks count), headlines."""
    sig: dict[str, dict] = {}
    for r in st:
        for s in r["stocks"]:
            x = sig.setdefault(s, {"n": 0, "score": 0, "headlines": []})
            x["n"] += 1
            if len(r["stocks"]) <= MAX_SYMS:
                x["score"] += r["score"]
            x["headlines"].append(f"{r['at'][5:16].replace('T', ' ')} {r['slug']}")
    return sig


def picks(sig: dict[str, dict], k: int = K) -> tuple[list[str], list[str]]:
    """(buys, shorts): up to k stocks with the highest good score and up to k with the lowest bad score."""
    longs = sorted((s for s, x in sig.items() if x["score"] > 0), key=lambda s: (-sig[s]["score"], -sig[s]["n"], s))[:k]
    shorts = sorted((s for s, x in sig.items() if x["score"] < 0), key=lambda s: (sig[s]["score"], -sig[s]["n"], s))[:k]
    return longs, shorts


def _session_open(today: dt.date) -> bool:
    try:
        d = live.fetch_today([config.BENCHMARK], today)
        df = d.get(config.BENCHMARK)
        return df is not None and len(df) > 0
    except Exception:  # noqa: BLE001
        return False


def _write(rec: dict) -> None:
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, indent=1, default=str))
    tmp.replace(OUT)


def run(trade: bool = True) -> dict:
    """The day's news check; with trade=True also waits for 09:20 and opens the paper trades (never twice a day)."""
    today = day_to_date(live.today_ist())
    if today.weekday() >= 5:
        return {"day": today.isoformat(), "status": "weekend"}
    prev = day_to_date(live.last_session_day())
    lo, hi = f"{prev.isoformat()}T15:30:00", f"{today.isoformat()}T09:15:00"
    if trade:
        while live.minute_ist() < 9 * 60 + 15.5:  # the 09:15 stories are in the sitemap a few seconds later
            time.sleep(5)
    st = stories(lo, hi)
    sig = signals(st)
    longs, shorts = picks(sig)
    rec = {"day": today.isoformat(), "window": [lo, hi], "stories": len(st), "linked": sum(1 for r in st if r["stocks"]),
           "signals": sig, "buy": longs, "short": shorts, "trades": [], "status": "checked"}
    _write(rec)
    log(f"news {today}: {len(st)} pre-open stories, {rec['linked']} about our stocks; BUY {longs or '-'}; SHORT {shorts or '-'}")
    if not trade:
        return rec
    if any(r.get("book") == "news" and r.get("day") == today.isoformat() for r in manual._load()):
        rec["status"] = "already traded today"
        _write(rec)
        return rec
    while live.minute_ist() < 9 * 60 + 20.5:
        time.sleep(2)
    while not _session_open(today):  # the 09:15-09:20 bar is the proof of a session; a holiday never gets one
        if live.minute_ist() >= 9 * 60 + 35:
            rec["status"] = "no session (holiday?)"
            _write(rec)
            log(f"news {today}: no session, no trade")
            return rec
        time.sleep(15)
    for side, syms in (("long", longs), ("short", shorts)):
        for s in syms:
            note = f"News book: {'good' if side == 'long' else 'bad'} news before the open: {sig[s]['headlines'][0][12:]}"[:300]
            try:
                t = manual.open_trade(s, side, note=note, stop_pct=STOP, book="news", value=SLOT)
                rec["trades"].append({"symbol": s, "side": side, "entry": t["entry"], "qty": t["qty"], "time": t["entry_time"]})
                log(f"paper {'BUY' if side == 'long' else 'SHORT'} {t['qty']} {s} @ {t['entry']} ({note})")
            except Exception as e:  # noqa: BLE001
                rec["trades"].append({"symbol": s, "side": side, "error": str(e)[:200]})
                log(f"paper {side} {s} not opened: {e}")
    rec["status"] = "traded"
    _write(rec)
    return rec
