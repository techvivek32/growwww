/**
 * Runs once when the Next.js server boots: starts the live-trading executor
 * (src/lib/liveTrading/executor.ts), which follows the research engine's
 * book A and trades it in the eligible accounts — Node.js runtime only (it
 * uses the filesystem and the broker connections). It must not hold up the
 * server: starting it only sets a timer.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startLiveExecutor } = await import("@/lib/liveTrading/executor");
  startLiveExecutor();
  // The time-based alerts (a period closing, a call tomorrow, a verification
  // nobody has reviewed). Its own slow hourly loop rather than a job inside
  // the executor, so a filesystem read here can never delay a square-off.
  const { startAlertSweep } = await import("@/lib/push/sweep");
  startAlertSweep();
  // The admin's stock alerts in the live market (Book A's signals, watchlist moves): read-only, its own 15-second loop.
  const { startTradeAlerts } = await import("@/lib/tradeAlerts");
  startTradeAlerts();
}
