/**
 * One flat rail in the top bar carrying every section, the way NOVA Terminal
 * listed them — Groww's chrome, NOVA's feature set.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label used once the rail has to scroll on small screens. */
  short?: string;
  group: "trading" | "system";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/stocks/alerts", label: "Stock Alerts", short: "Alerts", group: "trading" },
  { href: "/fno/alerts", label: "F&O Alerts", short: "F&O", group: "trading" },
  { href: "/fno/chain", label: "F&O Options", short: "Options", group: "trading" },
  { href: "/stocks/scanner", label: "Scanner", group: "trading" },
  { href: "/stocks/watchlist", label: "Watchlist", group: "trading" },
  { href: "/portfolio/holdings", label: "Portfolio", group: "trading" },
  { href: "/portfolio/positions", label: "Positions", group: "trading" },
  { href: "/portfolio/orders", label: "Orders", group: "trading" },
  { href: "/portfolio/history", label: "History", group: "trading" },
  { href: "/portfolio/analysis", label: "Analysis", group: "trading" },
  { href: "/broker", label: "Broker", group: "system" },
  { href: "/settings", label: "Settings", group: "system" },
];

export function itemForPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.href === pathname);
}
