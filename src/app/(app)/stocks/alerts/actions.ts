"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";
import { runScan, refreshBacktests } from "@/lib/signals/engine";

/**
 * Force a scan + backtest now, rather than waiting for the loop. Handy off
 * hours to refresh the measured edge and resolve anything that has hit its
 * level. Session-gated like every mutation.
 */
export async function refreshSignalsAction(): Promise<void> {
  const jar = await cookies();
  if (!(await verifyToken(jar.get(SESSION_COOKIE)?.value))) return;

  await Promise.allSettled([runScan(), refreshBacktests()]);
  revalidatePath("/stocks/alerts");
}
