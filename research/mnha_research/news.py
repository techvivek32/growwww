"""The morning NEWS LIST: company news published before the open. No trade, paper or real, is made from here.

09:14 IST (timer mnha-news, Mon-Fri), the job:
  - reads every Business Today story whose sitemap time (lastmod) falls after the previous session's 15:30 and at or before
    09:15 today. lastmod is at or after publication, so nothing published after the open slips in;
  - links each headline to the liquid F&O stocks Book A trades (news_terms.ALIASES) and scores it good / bad by its words.
    A story naming more than 3 stocks ("stocks to watch" lists) counts as a mention only;
  - writes the list to data/news_today.json and a line to data/news.log, for the owner to read.
History: from 27 Nov 2026 this job also opened paper trades at 09:20 (buy up to 3 good-news, short up to 3 bad-news stocks).
The owner stopped them the same day: the lab test (exp/news, pre-registered) found that buying good pre-open news lost
−3.4% a month 2023-26 and that no news rule beat Book A. Their two paper trades stay in data/manual_trades.json (book "news").
The owner chose this source on 27 Nov 2026: businesstoday.in/markets/stocks. Its robots.txt allows the sitemaps read here."""

from __future__ import annotations

import datetime as dt
import json
import re
import time
import urllib.request

from . import config, live
from .news_terms import ALIASES, EXCL, score
from .validation import day_to_date

SITEMAP = "https://www.businesstoday.in/rssfeeds/date-wise-story-sitemap.xml?yyyy={y}&mm={m:02d}&dd={d:02d}"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
OUT = config.DATA / "news_today.json"
LOG = config.DATA / "news.log"
K = 3  # names per side in the list's good / bad picks
MAX_SYMS = 3  # a story naming more stocks than this is a list, not news about one company
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


def _write(rec: dict) -> None:
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, indent=1, default=str))
    tmp.replace(OUT)


def run() -> dict:
    """The day's morning news list (no trades). Run between 09:00 and 09:15:30 it first waits for 09:15:30, so the
    stories up to 09:15 are in the sitemap."""
    today = day_to_date(live.today_ist())
    if today.weekday() >= 5:
        return {"day": today.isoformat(), "status": "weekend"}
    prev = day_to_date(live.last_session_day())
    lo, hi = f"{prev.isoformat()}T15:30:00", f"{today.isoformat()}T09:15:00"
    while 9 * 60 <= live.minute_ist() < 9 * 60 + 15.5:
        time.sleep(5)
    st = stories(lo, hi)
    sig = signals(st)
    good, bad = picks(sig)
    rec = {"day": today.isoformat(), "window": [lo, hi], "stories": len(st), "linked": sum(1 for r in st if r["stocks"]),
           "signals": sig, "good": good, "bad": bad, "status": "list only (no trades)"}
    _write(rec)
    log(f"news {today}: {len(st)} pre-open stories, {rec['linked']} about our stocks; good news {good or '-'}; bad news {bad or '-'} (list only)")
    return rec
