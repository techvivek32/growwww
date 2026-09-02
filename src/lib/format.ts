/** India-first formatters. Everything user-facing is en-IN + rupees. */

const inr = (d: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

/** ₹1,22,29,391.00 — note the Indian lakh/crore grouping, not thousands. */
export function fmtMoney(n: number, decimals = 2): string {
  return "₹" + inr(decimals).format(n);
}

/** Signed rupees: +₹1,240.50 / -₹980.00 */
export function fmtMoneySigned(n: number, decimals = 2): string {
  return (n >= 0 ? "+" : "-") + "₹" + inr(decimals).format(Math.abs(n));
}

/**
 * Price for a compact tile. Paise stop being meaningful past four figures and
 * start overflowing the entry/target/stop boxes, so ₹20,480 loses them while
 * ₹417.85 keeps them.
 */
export function fmtPrice(n: number): string {
  return "₹" + inr(Math.abs(n) >= 1000 ? 0 : 2).format(n);
}

/** Plain Indian-grouped integer: 3,41,30,323 */
export function fmtNum(n: number, decimals = 0): string {
  return inr(decimals).format(n);
}

/** +4.05% / -0.59% */
export function fmtPct(n: number, decimals = 2): string {
  return (n >= 0 ? "+" : "") + n.toFixed(decimals) + "%";
}

/** 3.4Cr / 12.2L / 45.3K — how Indian volume is actually read. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (a >= 1e5) return (n / 1e5).toFixed(2) + "L";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function toneOf(n: number): "up" | "down" | "flat" {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

/** Tailwind text colour for a signed number. */
export function toneText(n: number): string {
  if (n > 0) return "text-up";
  if (n < 0) return "text-down";
  return "text-ink2";
}
