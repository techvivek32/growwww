# MNHA research engine

A separate Python service that generates 100,000 strategy definitions, backtests
them on NSE candles from Groww, validates the survivors, ranks them and trains
a meta-label model. It has no order code: it never places, modifies or
cancels anything.

It runs on its own box (Hostinger KVM 1: 1 vCPU, 4 GB) at `/opt/mnha-research`.

## Pipeline

| Step | What it does | Where results go |
|---|---|---|
| ingest | Groww candles (5m, 15m, 30m, 60m, daily) for NSE F&O equities and NIFTY/BANKNIFTY. Incremental. Pauses 09:00–15:45 IST so the live terminal keeps its rate budget | `data/candles/<interval>/<symbol>.parquet` |
| quality | Gaps, OHLC sanity, session completeness, suspected corporate-action breaks. Freezes a data version (hash of every file) | `data_quality`, `data_versions` |
| generate | 100,000 unique DNAs, 12,500 per family, seeded and deduplicated by hash | `strategy_definitions` |
| screen | Every DNA on the train period (first 60%) of the 40 most liquid symbols | `strategy_metrics` (segment `train`) |
| validate | Stage-1 survivors on the full universe, train and validation periods. Also FDR, PBO and the walk-forward selection test | `strategy_metrics`, `validation_results`, run summary |
| deep | Stage-2 survivors: every trade stored, walk-forward folds, Monte Carlo, costs ×2, parameter neighbours, regimes, portfolio curve, deflated Sharpe. The test period (last 20%) is evaluated here, once | `strategy_trades`, `validation_results` |
| rank | Gates first, then a weighted score. The test period labels the status but never reorders the board | `strategy_rankings` |
| train | Meta-label classifier: fit on train, threshold on validation, judged on test | `ml_models`, `data/models/` |
| short | The same screen → validate → deep → rank → train stages for a second program: 5,000 cash-equity strategies held at most 3 sessions (intraday, or carried 1–3 nights long-only), on a ₹5 lakh book of 5 positions of ₹1 lakh. Adds short-term rules (IBS, down days, opening gap, narrow-range break) and NSE delivery-share filters. Runs are kinds `short_*`; `/rankings?program=short` | same tables, DNA version 2 |
| alpha | Weekly stock-ranking model over the 150 most liquid names, daily bars from 2003. Expanding-window walk-forward (refit every year), judged against NIFTYBEES, the equal-weight universe and plain 12-1 momentum, after delivery costs. See the top of `alpha.py` | run summary, `ml_models` (`alpha_*`), `data/models/` |
| daytrade | Intraday ranking model, cash equity MIS, ₹5 lakh book. Stage 1 ranks the liquid F&O stocks at the open (gap, recent days, NSE delivery share, stock-futures open interest as information, market state), walk-forward from 2010. Stage 2 decides at 09:20 from the stage-1 score and the first 5-minute bar, trained on the tradeable 09:20 → 15:15 move (5-minute data from 2020-07). Sessions from 2024 on were sealed until one `--final` run (run 20) | run summary (`daytrade_dev`, `daytrade_final`), `data/daytrade_pred*.npy` |
| paper | Forward test. A book freezes one alpha model. Every Friday after the close it stores that week's ranked list with a timestamp, and marks the book at the next session's close. No orders | `paper_books`, `paper_picks`, `paper_marks` |
| lab | Intraday research panel (`lab-build`): one row per (session, eligible stock) from 2020-07, with every feature known at 09:20 and the day's 72 five-minute bars. Walk-forward models, walk-forward variant selection (`lab.select`), tick-aware slippage, Groww intraday costs, an exposure check and a leak test. Sessions from 2026-05-01 are sealed (`lab.load(final=True)` only) | `data/lab/panel.parquet`, `data/lab/paths.npz` |
| live | Live PAPER trading of the 09:20 short rule on real Groww data — no orders, ever. `live-prepare` (08:10 IST) brings bars, NSE files and this year's frozen models up to date; `live-decide` (09:20) scores the first 5-minute bar with exactly the backtest's features and stores each book's picks plus the live price at decision time; `live-settle` (15:25) prices the books from the day's bars with the backtest's fills and costs. Books: `k1` (whole book in the lowest score, to 15:15), `k1_stops` (same pick, 3% stop + 0.5% market stop), `k3` (three shorts). `live-parity` replays past sessions through the live code and compares picks with the backtest | `live_days`, `live_rows`, `live_picks`, `live_trades`; `live-report` |
| nse-update | NSE delivery share (MTO) and stock F&O open interest for every session since the last stored one | `data/nse/delivery.parquet`, `data/nse/fo_oi.parquet` |

Execution rules, cost model and the statistics are documented at the top of
`engine.py`, `costs.py` and `validation.py`.

## Operating it

```sh
# on the server
nano /etc/mnha-research.env              # GROWW_API_KEY, GROWW_TOTP_SECRET
systemctl start mnha-research            # the full run, in the background
tail -f /opt/mnha-research/data/research.log
cd /opt/mnha-research && .venv/bin/python -m mnha_research status
curl -s localhost:8100/rankings?limit=20 # read-only API
```

A weekly timer (Saturday 06:00 IST) refreshes data and re-runs research on the
new data version. Every run keeps its own id, so old results are never
overwritten.

A second timer (`mnha-paper`, Mon–Fri 16:30 IST) runs `daily`. It pulls the
day's daily bars, publishes the week's list on Friday, and marks every paper
book. To open the books once, run `python -m mnha_research paper-start`. Both
timers need `GROWW_API_KEY` and `GROWW_TOTP_SECRET`. A pasted access token
expires at 06:00 IST the next day.

### Live paper trading (no orders)

```sh
sh deploy/live-setup.sh                  # once: NSE files, bars, lab panel, frozen models, three timers
tail -f /opt/mnha-research/data/live.log
.venv/bin/python -m mnha_research live-report
.venv/bin/python -m mnha_research live-parity --days 2026-03-27,2026-04-15
```

The timers run Mon–Fri:
- `live-prepare` at 08:10 IST;
- `live-decide` at 09:17, waiting for the 09:15 bar to complete at 09:20;
- `live-settle` at 15:25.

A holiday is recognised when no bars arrive by 09:35.

The models used in a year are fitted once on every session before 1 January, exactly as the backtest's yearly walk-forward. So the paper results are a forward test of the same rule the backtest measured. In January:
1. run `daytrade --final`;
2. run `lab-build`;
3. run `live-train` for the new year.

`live-report` shows each book's ₹ result per month, twice:
- from the 09:20 bar close (the backtest's convention);
- from the live price at the moment the decision was stored (closer to what a real order would have got).

## Developing

```sh
rsync -az --delete --exclude data/ --exclude .venv/ research/ root@<host>:/opt/mnha-research/
ssh root@<host> 'cd /opt/mnha-research && .venv/bin/python -m pytest -q tests'
```

## Known limits

- **Survivorship bias.** A stock may be entered only on days it had stock futures (`pit.py`, from monthly NSE F&O bhavcopies), and the daily universe includes former members. Groww has no history for delisted or merged companies (about 96 former members), and no intraday history is pulled for former members, so some bias remains. NSE archives are unreachable from this host: `data/nse/` (membership, symbol changes, delivery share) is fetched elsewhere and copied in.
- **Corporate actions.** Groww's daily bars are adjusted for splits and bonuses, but not for demergers. Its intraday bars are adjusted for neither: `quality.reconcile` finds each split or bonus as a lasting step in the daily/intraday close ratio (148 on the current data) and the pipeline cuts the intraday series there. The strategy pipeline cuts a daily series at a suspected break. `alpha` back-adjusts the 2010-01-04 scale break and a short list of verified demergers (`KNOWN_ACTIONS`).
- **Bad ticks.** Intraday highs and lows outside the day's daily range are clipped (on 2025-05-12 about 215 stocks have one 15-minute high about 100x the price). ADANIENT and INOXWIND are unusable: their daily and intraday series disagree beyond any corporate action (ADANIENT's daily closes sit near ₹1,600–1,950 for years). Results computed before 2026-11-04 (the 100k run, runs 1–5) used the unclipped bars.
- **Daily history before 2010.** Opens and lows are unreliable, so `alpha` uses only closes and volumes, and trades at the close. Costs before 2020-07 use approximate schedules that err on the expensive side (`costs.py`).
- **Brokerage.** Modelled on Groww's equity plan. Verify it against groww.in/pricing before trusting absolute ₹ numbers.
- **Validated is not profitable live.** A strategy that passes every gate is a candidate for paper trading, nothing more.
