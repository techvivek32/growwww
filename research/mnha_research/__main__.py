"""CLI: python -m mnha_research <command>

  init        create / migrate the database
  universe    refresh the instrument universe from Groww
  probe       find how far back Groww serves each interval
  ingest      pull candles (incremental; pauses during market hours)
  quality     run data checks and freeze a data version
  generate    create the strategy definitions (--program main|short)
  research    screen → validate → deep → rank → train
  short       the same stages for the short-hold program: 5,000 cash-equity
              strategies held at most 3 sessions, a ₹5 lakh book of 5 positions
  alpha       walk-forward stock-ranking model vs NIFTYBEES / equal weight / momentum
  daytrade    intraday ranking model (MIS, flat by 15:15) on ₹5 lakh; --final also
              evaluates the sealed holdout (2024 on) — run that once
  daytrade-refine  execution variants of the 09:20 short rule, chosen walk-forward
  lab-build   build the intraday research panel (lab.py) from 5-minute bars
  paper-start open paper books that freeze the latest alpha models
  paper       publish this week's lists (if due) and mark the paper books
  daily       after-close job: daily bars → paper publish → paper mark
  nse-update  fetch NSE delivery share and F&O open interest up to yesterday
  live-train  freeze this year's intraday models (needs lab-build) for live paper trading
  live-prepare  before the open: bars, NSE files, models (live paper trading; no orders)
  live-decide   09:20: score today's first 5-minute bar, store the paper picks
  live-settle   after 15:15: price today's paper books from the day's bars
  live-report   paper results per book so far
  live-parity   replay past sessions through the live code and compare with the backtest (--days)
  all         universe → probe → ingest → quality → research → alpha
  status      print run status
  serve       start the read-only API on 127.0.0.1:8100
"""

from __future__ import annotations

import argparse
import json
import sys

from . import config, db


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="mnha_research")
    p.add_argument("command")
    p.add_argument("--symbols", help="comma-separated subset (ingest)")
    p.add_argument("--intervals", help="comma-separated minutes (ingest)")
    p.add_argument("--ignore-market-hours", action="store_true", help="ingest even while the market is open")
    p.add_argument("--total", type=int, help="strategies to generate (default: the program's)")
    p.add_argument("--program", default="main", help="main | short (generate)")
    p.add_argument("--variants", help="comma-separated alpha variants (paper-start)")
    p.add_argument("--final", action="store_true", help="daytrade: evaluate the sealed holdout too")
    p.add_argument("--days", help="comma-separated YYYY-MM-DD (live-parity)")
    p.add_argument("--year", type=int, help="model year (live-train)")
    p.add_argument("--no-wait", action="store_true", help="live-decide: do not wait for 09:20")
    a = p.parse_args(argv)
    db.migrate()

    from . import ingest, pipeline, quality

    cmd = a.command
    if cmd == "init":
        print("database ready at", config.DB_PATH)
    elif cmd == "universe":
        print(len(ingest.refresh_universe()), "symbols")
    elif cmd == "probe":
        from .groww import Groww

        print(json.dumps(ingest.probe(Groww())))
    elif cmd == "ingest":
        syms = a.symbols.split(",") if a.symbols else None
        ivs = tuple(int(x) for x in a.intervals.split(",")) if a.intervals else config.INTERVALS
        print(json.dumps(ingest.ingest(syms, ivs, respect_hours=not a.ignore_market_hours)))
    elif cmd == "quality":
        v = ingest.snapshot_version()
        print("data version", v, json.dumps(quality.run(v, ingest.universe())))
    elif cmd == "generate":
        print(json.dumps(pipeline.generate(a.total, prog=pipeline.PROGRAMS[a.program])))
    elif cmd == "research":
        print(json.dumps(pipeline.research(), default=str, indent=1))
    elif cmd == "short":
        print(json.dumps(pipeline.research(prog=pipeline.SHORT), default=str, indent=1))
    elif cmd == "alpha":
        from . import alpha

        print(json.dumps(alpha.run(data_version=ingest.latest_version()), default=str, indent=1))
    elif cmd == "daytrade":
        from . import daytrade

        print(json.dumps(daytrade.run(final=a.final), default=str, indent=1))
    elif cmd == "daytrade-refine":
        from . import refine

        print(json.dumps(refine.run(), default=str, indent=1))
    elif cmd == "lab-build":
        from . import lab

        print(json.dumps(lab.build(), default=str, indent=1))
    elif cmd == "paper-start":
        from . import paper

        print(json.dumps(paper.start(a.variants.split(",") if a.variants else None), indent=1))
    elif cmd == "paper":
        from . import alpha, paper

        des, _ = alpha.load_design()
        print(json.dumps({"publish": paper.publish(des=des), "mark": paper.mark(des)}, default=str, indent=1))
    elif cmd == "daily":
        from . import paper

        print(json.dumps(paper.daily(), default=str, indent=1))
    elif cmd == "nse-update":
        from . import nse

        print(json.dumps(nse.update(), indent=1))
    elif cmd.startswith("live-"):
        import datetime as dt

        from . import live

        if cmd == "live-train":
            out = live.train(a.year)
        elif cmd == "live-prepare":
            out = live.prepare()
        elif cmd == "live-decide":
            out = live.decide(wait=not a.no_wait)
        elif cmd == "live-settle":
            out = live.settle()
        elif cmd == "live-report":
            out = live.report()
        elif cmd == "live-parity":
            days = [(dt.date.fromisoformat(x) - dt.date(1970, 1, 1)).days for x in (a.days or "").split(",") if x]
            out = [live.parity(d) for d in days]
        else:
            p.print_help()
            return 2
        print(json.dumps(out, default=str, indent=1))
    elif cmd == "all":
        from .groww import Groww

        ingest.refresh_universe()
        ingest.probe(Groww())
        print(json.dumps(ingest.ingest(respect_hours=not a.ignore_market_hours)))
        v = ingest.snapshot_version()
        print("data version", v, json.dumps(quality.run(v, ingest.universe())))
        print(json.dumps(pipeline.research(v), default=str, indent=1))
        from . import alpha

        print(json.dumps(alpha.run(data_version=v), default=str, indent=1))
    elif cmd == "status":
        from .api import status

        print(json.dumps(status(), indent=1, default=str))
    elif cmd == "serve":
        import uvicorn

        uvicorn.run("mnha_research.api:app", host="127.0.0.1", port=8100, workers=1)
    else:
        p.print_help()
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
