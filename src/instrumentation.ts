/**
 * Runs once when the Next.js server boots. We use it to start the signal
 * engine's background loop — the scan/resolve/backtest cadence — in the
 * Node.js runtime only (it touches the filesystem and the broker socket).
 * The Edge runtime import is skipped.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startEngine } = await import("@/lib/signals/engine");
  startEngine();
}
