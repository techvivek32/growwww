"""Fixed word lists of the NEWS paper book (news.py) and its lab test (lab exp/news), one copy for both.

ALIASES: headline-slug patterns per stock (matched as -pattern- inside -slug-); EXCL: patterns that veto a match
(another company of the same group, e.g. sbi-card for SBIN). POS / NEG: good / bad words; score() = good − bad.
Written 27 Nov 2026 before any result of the test was seen; change them only with a new pre-registered test."""

ALIASES = {
 "360ONE": ["360-one"], "ABB": ["abb-india", "abb-shares", "abb-share", "abb-stock", "abb"], "ABCAPITAL": ["aditya-birla-capital", "ab-capital"],
 "ADANIENSOL": ["adani-energy-solutions", "adani-energy", "adani-transmission"], "ADANIGREEN": ["adani-green"], "ADANIPORTS": ["adani-ports"],
 "ADANIPOWER": ["adani-power"], "ALKEM": ["alkem"], "AMBER": ["amber-enterprises", "amber-shares"], "AMBUJACEM": ["ambuja"],
 "ANGELONE": ["angel-one", "angel-broking"], "APLAPOLLO": ["apl-apollo"], "APOLLOHOSP": ["apollo-hospitals", "apollo-hospital"],
 "ASHOKLEY": ["ashok-leyland"], "ASIANPAINT": ["asian-paints", "asian-paint"], "ASTRAL": ["astral"], "AUBANK": ["au-small-finance", "au-bank", "au-sfb"],
 "AUROPHARMA": ["aurobindo"], "AXISBANK": ["axis-bank"], "BAJAJ-AUTO": ["bajaj-auto"], "BAJAJFINSV": ["bajaj-finserv"], "BAJFINANCE": ["bajaj-finance"],
 "BANDHANBNK": ["bandhan"], "BANKBARODA": ["bank-of-baroda", "bob-shares"], "BANKINDIA": ["bank-of-india"], "BDL": ["bharat-dynamics", "bdl"],
 "BEL": ["bharat-electronics", "bel"], "BHARATFORG": ["bharat-forge"], "BHARTIARTL": ["bharti-airtel", "airtel"], "BHEL": ["bhel"], "BIOCON": ["biocon"],
 "BLUESTARCO": ["blue-star"], "BOSCHLTD": ["bosch"], "BPCL": ["bpcl", "bharat-petroleum"], "BRITANNIA": ["britannia"],
 "BSE": ["bse-shares", "bse-share", "bse-stock", "bse-ltd", "bse-limited", "bse-q1", "bse-q2", "bse-q3", "bse-q4"], "CAMS": ["cams", "computer-age-management"],
 "CANBK": ["canara-bank"], "CDSL": ["cdsl"], "CGPOWER": ["cg-power"], "CHOLAFIN": ["cholamandalam", "chola-finance"], "CIPLA": ["cipla"],
 "COALINDIA": ["coal-india"], "COCHINSHIP": ["cochin-shipyard"], "COFORGE": ["coforge"], "COLPAL": ["colgate"], "CONCOR": ["concor", "container-corporation"],
 "COROMANDEL": ["coromandel"], "CROMPTON": ["crompton"], "CUB": ["city-union-bank"], "CUMMINSIND": ["cummins"], "DABUR": ["dabur"],
 "DELHIVERY": ["delhivery"], "DIVISLAB": ["divi-s-lab", "divis-lab", "divi-s-laboratories", "divis-laboratories", "divis"], "DIXON": ["dixon"],
 "DLF": ["dlf"], "DMART": ["dmart", "d-mart", "avenue-supermarts"], "DRREDDY": ["dr-reddy", "dr-reddys", "dr-reddy-s"], "EICHERMOT": ["eicher"],
 "ETERNAL": ["zomato", "eternal-shares", "eternal-share", "eternal-stock", "eternal-q1", "eternal-q2", "eternal-q3", "eternal-q4", "eternal-ltd"],
 "FEDERALBNK": ["federal-bank"], "FORCEMOT": ["force-motors"], "FORTIS": ["fortis"], "GAIL": ["gail"], "GLENMARK": ["glenmark"],
 "GMRAIRPORT": ["gmr-airports", "gmr-infra", "gmr"], "GODREJCP": ["godrej-consumer"], "GODREJPROP": ["godrej-properties", "godrej-property"],
 "GRASIM": ["grasim"], "HAL": ["hindustan-aeronautics", "hal"], "HAVELLS": ["havells"], "HCLTECH": ["hcl-tech", "hcltech", "hcl-technologies"],
 "HDFCAMC": ["hdfc-amc", "hdfc-asset"], "HDFCBANK": ["hdfc-bank"], "HDFCLIFE": ["hdfc-life"], "HEROMOTOCO": ["hero-motocorp", "hero-moto"],
 "HINDALCO": ["hindalco"], "HINDPETRO": ["hpcl", "hindustan-petroleum"], "HINDUNILVR": ["hindustan-unilever", "hul"], "HINDZINC": ["hindustan-zinc", "hind-zinc"],
 "HYUNDAI": ["hyundai-motor-india", "hyundai-india", "hyundai-shares", "hyundai-share", "hyundai-stock"], "ICICIBANK": ["icici-bank"],
 "ICICIGI": ["icici-lombard"], "IDEA": ["vodafone-idea"], "IDFCFIRSTB": ["idfc-first"], "IEX": ["iex", "indian-energy-exchange"],
 "INDHOTEL": ["indian-hotels", "ihcl"], "INDIANB": ["indian-bank"], "INDIGO": ["indigo", "interglobe"], "INDUSINDBK": ["indusind"],
 "INDUSTOWER": ["indus-towers", "indus-tower"], "INFY": ["infosys"], "IOC": ["ioc", "indian-oil"], "IREDA": ["ireda"], "IRFC": ["irfc"],
 "ITC": ["itc"], "JINDALSTEL": ["jindal-steel", "jspl"], "JIOFIN": ["jio-financial", "jio-finance"], "JSWENERGY": ["jsw-energy"], "JSWSTEEL": ["jsw-steel"],
 "JUBLFOOD": ["jubilant-foodworks", "jubilant-food"], "KALYANKJIL": ["kalyan-jewellers"], "KAYNES": ["kaynes"], "KEI": ["kei-industries", "kei-shares", "kei-share"],
 "KFINTECH": ["kfin-technologies", "kfintech", "kfin-tech"], "KOTAKBANK": ["kotak-mahindra-bank", "kotak-bank", "kotak-mahindra"], "KPITTECH": ["kpit"],
 "LAURUSLABS": ["laurus"], "LICHSGFIN": ["lic-housing"], "LICI": ["lic", "life-insurance-corporation"], "LODHA": ["lodha", "macrotech"],
 "LT": ["larsen", "l-t"], "LTF": ["l-t-finance", "lt-finance"], "LTM": ["ltimindtree", "lti-mindtree", "ltim"],
 "LUPIN": ["lupin"], "M&M": ["mahindra-mahindra", "mahindra-and-mahindra", "m-m"], "MANAPPURAM": ["manappuram"], "MANKIND": ["mankind-pharma", "mankind"],
 "MARICO": ["marico"], "MARUTI": ["maruti"], "MAXHEALTH": ["max-healthcare"], "MAZDOCK": ["mazagon-dock", "mazagon", "mazdock"],
 "MCX": ["mcx-shares", "mcx-share", "mcx-stock", "multi-commodity-exchange", "mcx-q1", "mcx-q2", "mcx-q3", "mcx-q4"], "MFSL": ["max-financial"],
 "MOTHERSON": ["motherson", "samvardhana"], "MPHASIS": ["mphasis"], "MUTHOOTFIN": ["muthoot"], "NAM-INDIA": ["nippon-life", "nippon-india-amc", "nippon-amc"],
 "NATIONALUM": ["nalco", "national-aluminium"], "NAUKRI": ["info-edge", "naukri"], "NAVINFLUOR": ["navin-fluorine"], "NBCC": ["nbcc"],
 "NESTLEIND": ["nestle"], "NHPC": ["nhpc"], "NMDC": ["nmdc"], "NTPC": ["ntpc"], "NYKAA": ["nykaa", "fsn-e-commerce"], "OBEROIRLTY": ["oberoi-realty"],
 "OFSS": ["oracle-financial", "ofss"], "OIL": ["oil-india"], "ONGC": ["ongc"], "PAGEIND": ["page-industries"], "PATANJALI": ["patanjali"],
 "PAYTM": ["paytm", "one97"], "PERSISTENT": ["persistent-systems", "persistent-shares", "persistent-share"], "PETRONET": ["petronet"],
 "PFC": ["pfc", "power-finance"], "PGEL": ["pg-electroplast"], "PHOENIXLTD": ["phoenix-mills"], "PIDILITIND": ["pidilite"], "PIIND": ["pi-industries"],
 "PNB": ["pnb", "punjab-national-bank"], "PNBHOUSING": ["pnb-housing"], "POLICYBZR": ["policybazaar", "pb-fintech"], "POLYCAB": ["polycab"],
 "POWERGRID": ["power-grid"], "POWERINDIA": ["hitachi-energy"], "PREMIERENE": ["premier-energies"], "PRESTIGE": ["prestige-estates", "prestige-estate"],
 "RBLBANK": ["rbl-bank", "rbl"], "RECLTD": ["rec-ltd", "rec-shares", "rec-share", "rec-limited"],
 "RELIANCE": ["reliance-industries", "ril", "reliance-shares", "reliance-share", "reliance-stock", "reliance-q1", "reliance-q2", "reliance-q3", "reliance-q4"],
 "RVNL": ["rvnl", "rail-vikas"], "SAIL": ["sail"], "SBICARD": ["sbi-card", "sbi-cards"], "SBILIFE": ["sbi-life"], "SBIN": ["sbi", "state-bank"],
 "SHREECEM": ["shree-cement"], "SHRIRAMFIN": ["shriram-finance"], "SIEMENS": ["siemens"], "SOLARINDS": ["solar-industries"], "SONACOMS": ["sona-comstar", "sona-blw"],
 "SRF": ["srf"], "SUNPHARMA": ["sun-pharma"], "SUZLON": ["suzlon"], "SWIGGY": ["swiggy"], "TATACONSUM": ["tata-consumer"], "TATAELXSI": ["tata-elxsi"],
 "TATAPOWER": ["tata-power"], "TATASTEEL": ["tata-steel"], "TCS": ["tcs", "tata-consultancy"], "TECHM": ["tech-mahindra"], "TIINDIA": ["tube-investments"],
 "TITAN": ["titan"], "TMPV": ["tata-motors", "tmpv"], "TORNTPHARM": ["torrent-pharma"], "TRENT": ["trent"], "TVSMOTOR": ["tvs-motor"],
 "ULTRACEMCO": ["ultratech"], "UNIONBANK": ["union-bank"], "UNITDSPR": ["united-spirits"], "UNOMINDA": ["uno-minda"], "UPL": ["upl"],
 "VBL": ["varun-beverages"], "VEDL": ["vedanta"], "VMM": ["vishal-mega-mart"], "VOLTAS": ["voltas"], "WAAREEENER": ["waaree-energies"], "WIPRO": ["wipro"],
 "YESBANK": ["yes-bank"], "ZYDUSLIFE": ["zydus"],
}
EXCL = {
 "ITC": ["itc-hotels"], "LT": ["l-t-finance", "l-t-tech", "l-t-technology", "lt-finance"], "SBIN": ["sbi-card", "sbi-cards", "sbi-life", "sbi-mutual", "sbi-funds",
 "sbi-general", "sbi-securities", "sbi-mf"], "PNB": ["pnb-housing"], "LICI": ["lic-housing"], "NTPC": ["ntpc-green"], "NMDC": ["nmdc-steel"],
 "SIEMENS": ["siemens-energy"], "TMPV": ["tata-motors-cv", "tata-motors-commercial"], "KOTAKBANK": ["kotak-securities", "kotak-institutional"],
 "MANKIND": [], "GMRAIRPORT": ["gmr-power"], "TITAN": [], "WAAREEENER": ["waaree-renewable"],
}

POS = ["jump", "jumps", "surge", "surges", "soar", "soars", "rally", "rallies", "zoom", "zooms", "gain", "gains", "rise", "rises", "climb",
       "climbs", "spurt", "spurts", "skyrocket", "skyrockets", "bags", "bag", "wins", "win", "order", "orders", "contract", "upgrade", "upgrades",
       "upgraded", "outperform", "overweight", "buy", "beats", "beat", "record", "approval", "approves", "nod", "dividend", "bonus", "buyback",
       "raises", "hike", "hikes", "strong", "robust", "upside", "bullish", "rebound", "rebounds", "recovers", "high", "profit-rises",
       "profit-jumps", "profit-surges", "rating-upgrade", "target-hike", "lowest-bidder", "l1", "secures", "inks", "partnership", "acquires"]
NEG = ["fall", "falls", "slump", "slumps", "plunge", "plunges", "crash", "crashes", "tank", "tanks", "slide", "slides", "drop", "drops",
       "decline", "declines", "sink", "sinks", "tumble", "tumbles", "skid", "skids", "dip", "dips", "downgrade", "downgrades", "downgraded",
       "underperform", "underweight", "sell", "cut", "cuts", "miss", "misses", "loss", "losses", "probe", "raid", "raids", "fraud", "penalty",
       "fine", "fined", "ban", "bans", "resign", "resigns", "resignation", "default", "pledge", "notice", "lawsuit", "sues", "sued", "concern",
       "concerns", "warning", "weak", "bearish", "downside", "low", "slashes", "slash", "halt", "halts", "scam", "sebi-order", "fire", "strike",
       "recall", "exits", "offload", "offloads", "stake-sale", "block-deal", "selloff", "sell-off", "pressure", "worry", "worries", "dent", "hit"]
_P, _N = set(POS), set(NEG)
def score(slug: str) -> int:
    toks = slug.split("-")
    bigr = {a + "-" + b for a, b in zip(toks, toks[1:])}
    p = sum(t in _P for t in toks) + sum(b in _P for b in bigr)
    n = sum(t in _N for t in toks) + sum(b in _N for b in bigr)
    if "stop-loss" in bigr:  # "targets, stop-loss" in trading-level lists is not bad news
        n -= 1
    return p - n
