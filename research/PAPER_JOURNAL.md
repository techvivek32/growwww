# Paper-trading journal

One entry per live session: what the rule did, what the market did, what we learned. Numbers are on the ₹5 lakh book, after
Groww charges and slippage. A lesson here changes the rules ONLY after it has been tested in the lab (`exp/search`,
walk-forward); the live book trades the tested rule, not yesterday's hindsight.

## Standing lessons

1. **One decider.** Two copies of the 09:20 decision ran concurrently on 19 Nov (session loop + a leftover timer) and
   disagreed. Only `livex-session` decides now. Never install a second decide/flip timer.
2. **Fetch the current session from the range endpoint.** The backtesting endpoint lagged the 09:15 bar by five minutes
   on 19 Nov, so the pick landed at 09:25. Fixed in `live.fetch_today`.
3. **The market stop is a risk control, not a profit rule.** It will sometimes cover a short that would have worked
   (19 Nov PAYTM). It exists because, on days when the average stock is up 0.5%+ by mid-morning, lone shorts are squeezed
   far more often than not. Judge it over months, never on one day.
4. **The 10:15 flip earns its keep on trending mornings** (19 Nov MARUTI +1.85% in five hours). It loses small on
   false starts (17 Nov PNB −₹3,306). Keep both facts in view.
5. **A fixed 0.5% per-stock stop is noise-driven.** 16 Nov: stopped out by a 0.5% wiggle, then the stock fell 2%.
   Book B stays as the live test of that rule; the backtest says it halves the result.
6. **Close picks are fragile.** The top three scores are often within 0.4 z of each other; a different data copy or a
   different first-bar subset flips the pick (18 Nov LAURUSLABS vs KAYNES). One production data source, one decider.
7. **Expectation discipline.** Four green days in a row (+6.1% of the book) is above the 5–6%/month the backtest
   supports. Losing days of −2% to −6% and months of −10% exist in the history; plan for them.

## Sessions

### Mon 16 Nov · Book A +₹8,491 (+1.70%) · Book B −₹2,863
- Short DATAPATTNS 117 × ₹4,255.72 at 09:20 (late replay from the Mac; the decision used only 09:20 data). No flip
  (median stock −0.12% since the open). Covered at 15:15, ₹4,181.25.
- Book B's 0.5% stop (₹4,277) was touched by the 09:30 bar high (₹4,278) before the stock fell 2%.
- Market: flat-to-down morning; the short rule's natural day.

### Tue 17 Nov · Book A +₹9,724 (+1.95%) · Book B +₹10,159
- Short KALYANKJIL 702 × ₹711.54. It fell fast (−3% by 09:40). 10:15 flip fired (strong median since the open): short
  covered at ₹692.66 (+₹13,031), long PNB 3,315 × ₹150.79 → ₹149.86 at 15:15 (−₹3,306).
- Lesson: the flip's cover banked the short's gain; its long leg was a false start. Net still +1.95%.

### Wed 18 Nov · Book A +₹4,059 (+0.81%) · Book B +₹4,059
- Short LAURUSLABS 212 × ₹2,350.29 (replayed from bars after the close). No flip (median −0.30%). Covered 15:15 at
  ₹2,330.10. Stops never touched.
- The server's data copy would have picked KAYNES (−₹176): the two were nearly tied. Lesson 6.

### Thu 19 Nov · Book A +₹8,411 (+1.68%) · Book B +₹4,698 — first fully live server day
- NIFTY +1.2%; the average stock +1.1% from 09:20 (peak +1.28%). A trend-up day.
- Short PAYTM 281 × ₹1,773.27 at 09:20 (decided 09:25: data lag, lesson 2). Market stop fired 09:50 (+0.63%):
  covered at ₹1,774.13, −₹466. PAYTM later fell to ₹1,724 at 15:15; holding would have made about +₹13,800. Lesson 3.
- 10:15 flip: long MARUTI 37 × ₹13,303.99 → ₹13,549.93 at 15:15, +₹8,877. The day's winner. Lesson 4.
- Duplicate decision: a second decide() picked POLICYBZR for Book B; stopped out 09:40, −₹3,624. Lesson 1. Fixed.
- Running: Book A +₹30,700 (+6.14%), 4/4 days positive; Book B +₹16,054 (+3.21%).

### Fri 20 Nov · Book A +₹18,388 (+3.68%) · Book B −₹5,826 — first fully clean live day
- Pick at 09:20:42 (the data-lag fix held), one decider. NIFTY +1.6% (25,368 → 25,785), BANKNIFTY +3.2%: a bank-led
  rally day; the average stock +1.0% from 09:20 by the close.
- Short TATASTEEL 2,860 × ₹174.81. It drifted up; the market stop was not reached by 10:15 (+0.3%), the flip fired
  (median +0.30% since the open) and covered at ₹175.90: −₹3,356.
- Flip long INDUSINDBK 523 × ₹955.69 → ₹997.70 at 15:15 (+4.4%): +₹21,744. The day's winner, second day running
  that the flip leg carried the book on a trending morning.
- Book B: both legs stopped by 0.5% wiggles (TATASTEEL 10:11, INDUSINDBK 10:17, both before the real moves): −₹5,826.
  Lesson 5 again: the tight stop exits exactly where the trend is about to start.
- Week 1: Book A +₹49,088 (+9.8%), 5/5 days; Book B +₹10,228 (+2.0%). Far above the backtest's average week; do not
  extrapolate (lesson 7).

### Mon 23 Nov · skipped (regime: Monday + top-20% NIFTY gap) · ₹0 both books
- NIFTY gapped up to 25,929 and sold off all morning. The skipped pick (TATASTEEL, −4.42) fell 1.8% by 10:00: today the
  filter cost a likely gain. Over 2023–26 the filter leaves the per-month figure unchanged (8.75% vs 8.71%) and cuts the
  worst month from −17.5% to −12.5%; judged over months, not days. Kalyan Jewellers, the #3 short candidate, rose 3.8%.
- Idea from the user (NSE top gainers/losers): on the 500-stock panel, yesterday's top-20 gainers continue +42 bps
  09:20→15:15 the next day (44% win, skewed by big winners); today's top gap-ups fade −20 bps; first-5-min top gainers
  lose −11 bps after 09:20. Worth a proper walk-forward test as a LONG rule; not live.
- Wider universe (Nifty 500, top-500 by turnover): base model K=3 9.38%/month vs 3.14% on the 150 F&O names. Needs
  liquidity slippage, the full rule and leak tests before any change to the live book.
