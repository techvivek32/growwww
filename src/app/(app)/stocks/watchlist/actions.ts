"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifyToken } from "@/lib/auth";
import { addSymbol, createList, deleteList, removeSymbol } from "@/lib/watchlists";
import { equityName } from "@/lib/instruments";
import { INDEX_TICKERS } from "@/lib/api/yahoo";

/**
 * Watchlist mutations. The session is re-verified and every symbol is checked
 * against the instrument master before it lands in the store — a watchlist
 * row that no feed can ever price is a dead pixel, not a feature.
 */

const SYMBOL_RE = /^[A-Z0-9&-]{1,30}$/;

async function signedIn(): Promise<boolean> {
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value);
}

export async function createListAction(form: FormData): Promise<void> {
  if (!(await signedIn())) return;
  const name = String(form.get("name") ?? "").trim();
  if (!name) return;
  const list = await createList(name);
  revalidatePath("/stocks/watchlist");
  redirect(`/stocks/watchlist?list=${list.id}`);
}

export async function deleteListAction(form: FormData): Promise<void> {
  if (!(await signedIn())) return;
  const id = String(form.get("id") ?? "");
  if (!id) return;
  await deleteList(id);
  revalidatePath("/stocks/watchlist");
  redirect("/stocks/watchlist");
}

export async function addSymbolAction(form: FormData): Promise<void> {
  if (!(await signedIn())) return;
  const id = String(form.get("id") ?? "");
  const symbol = String(form.get("symbol") ?? "").trim().toUpperCase();
  if (!id || !SYMBOL_RE.test(symbol)) return;

  const isIndex = INDEX_TICKERS.some((t) => t.symbol === symbol);
  const listed = isIndex || (await equityName(symbol).catch(() => null)) !== null;
  if (!listed) return;

  await addSymbol(id, symbol);
  revalidatePath("/stocks/watchlist");
}

export async function removeSymbolAction(form: FormData): Promise<void> {
  if (!(await signedIn())) return;
  const id = String(form.get("id") ?? "");
  const symbol = String(form.get("symbol") ?? "");
  if (!id || !symbol) return;
  await removeSymbol(id, symbol);
  revalidatePath("/stocks/watchlist");
}
