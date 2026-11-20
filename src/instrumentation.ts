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
}
