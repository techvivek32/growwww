import type { NextRequest } from "next/server";
import { subscribe } from "@/lib/tickhub";

/**
 * Server-sent tick stream. The browser holds this open and the tick hub
 * pushes prices as fast as its Groww cycle produces them — no client
 * polling, no per-tab upstream traffic.
 *
 * Sits behind the same session gate as every other route (proxy.ts).
 */

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 60;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z0-9&-]{1,30}$/.test(s)),
    ),
  ].slice(0, MAX_SYMBOLS);

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => controller.enqueue(encoder.encode(payload));

      // Confirms the stream is live before the first tick arrives.
      send(`retry: 2000\n\n`);

      cleanup = subscribe(symbols, send);

      // Keeps intermediaries from timing the connection out while quiet
      // (markets closed, empty symbol list).
      heartbeat = setInterval(() => {
        try {
          send(`: ping\n\n`);
        } catch {
          /* closed under us — abort handling below tears down */
        }
      }, 15_000);
    },
    cancel() {
      cleanup?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  req.signal.addEventListener("abort", () => {
    cleanup?.();
    if (heartbeat) clearInterval(heartbeat);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      // Tells nginx not to buffer — buffered SSE arrives in useless bursts.
      "X-Accel-Buffering": "no",
    },
  });
}
