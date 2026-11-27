"""The morning news list's pure parts: sitemap parsing, the pre-open window, headline → stock links, scores, picks."""
import datetime as dt

from mnha_research import news
from mnha_research.news_terms import score

XML = """<urlset><url><loc><![CDATA[ https://www.businesstoday.in/markets/stocks/story/biocon-in-focus-after-brazil-regulator-approves-biosimilar-cancer-drug-hertuzo-569801-2026-11-27 ]]></loc>
<lastmod><![CDATA[ 2026-11-27T08:58:10+05:30 ]]></lastmod></url>
<url><loc><![CDATA[ https://www.businesstoday.in/markets/stocks/story/laurus-labs-shares-plunge-8-569802-2026-11-27 ]]></loc>
<lastmod><![CDATA[ 2026-11-27T09:40:00+05:30 ]]></lastmod></url>
<url><loc><![CDATA[ https://www.businesstoday.in/latest/story/sbi-card-users-need-to-know-these-updates-569700-2026-11-26 ]]></loc>
<lastmod><![CDATA[ 2026-11-26T19:07:00+05:30 ]]></lastmod></url>
<url><loc><![CDATA[ https://www.businesstoday.in/markets/stocks/story/hdfc-bank-shares-rebound-from-52-week-low-569735-2026-11-26 ]]></loc>
<lastmod><![CDATA[ 2026-11-26T15:10:00+05:30 ]]></lastmod></url></urlset>"""


def test_parse_and_window():
    rows = news.parse_sitemap(XML)
    assert len(rows) == 4 and rows[0][0] == "2026-11-27T08:58:10"
    st = news.stories("2026-11-26T15:30:00", "2026-11-27T09:15:00", fetch=lambda d: rows)
    slugs = [r["slug"] for r in st]
    # 15:10 is before the previous close, 09:40 is after the open: both are left out
    assert slugs == ["sbi-card-users-need-to-know-these-updates", "biocon-in-focus-after-brazil-regulator-approves-biosimilar-cancer-drug-hertuzo"]


def test_links_and_exclusions():
    assert news.link("sbi-card-users-need-to-know-these-updates") == ["SBICARD"]
    assert news.link("sbi-q2-results-profit-rises") == ["SBIN"]
    assert news.link("waaree-renewable-shares-jump-14") == []
    assert news.link("l-t-finance-shares-rise") == ["LTF"]
    assert news.link("pnb-housing-shares-fall") == ["PNBHOUSING"]


def test_scores():
    assert score("biocon-in-focus-after-brazil-regulator-approves-biosimilar-cancer-drug-hertuzo") > 0
    assert score("laurus-labs-shares-plunge-8") < 0
    assert score("tcs-prestige-estates-mcx-top-stocks-to-trade-check-key-levels-targets-stop-loss") == 0


def test_signals_and_picks():
    st = [{"at": "2026-11-27T08:00:00", "slug": "a", "stocks": ["BIOCON"], "score": 2},
          {"at": "2026-11-27T08:10:00", "slug": "b", "stocks": ["LAURUSLABS"], "score": -1},
          {"at": "2026-11-27T08:20:00", "slug": "c", "stocks": ["TCS", "INFY", "WIPRO", "HCLTECH"], "score": 3},
          {"at": "2026-11-27T08:30:00", "slug": "d", "stocks": ["HDFCBANK"], "score": 1}]
    sig = news.signals(st)
    assert sig["TCS"]["n"] == 1 and sig["TCS"]["score"] == 0  # a list of 4 stocks is a mention, not news
    longs, shorts = news.picks(sig)
    assert longs == ["BIOCON", "HDFCBANK"] and shorts == ["LAURUSLABS"]
    assert news.picks({f"S{i}": {"n": 1, "score": 1} for i in range(5)})[0] == ["S0", "S1", "S2"]


def test_weekend_is_skipped(monkeypatch):
    monkeypatch.setattr(news.live, "today_ist", lambda: (dt.date(2026, 11, 28) - dt.date(1970, 1, 1)).days)
    assert news.run()["status"] == "weekend"
