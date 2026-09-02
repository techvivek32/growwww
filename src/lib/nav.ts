/**
 * Three top-level sections, mirroring Groww's own Stocks / F&O / Mutual Funds
 * bar. Each opens a row of sub-tabs, again exactly as Groww does it.
 */

export interface SubTab {
  href: string;
  label: string;
}

export interface Section {
  key: string;
  label: string;
  href: string;
  tabs: SubTab[];
}

export const SECTIONS: Section[] = [
  {
    key: "stocks",
    label: "Stocks",
    href: "/stocks/alerts",
    tabs: [
      { href: "/stocks/alerts", label: "AI Alerts" },
      { href: "/stocks/scanner", label: "Scanner" },
      { href: "/stocks/watchlist", label: "Watchlist" },
    ],
  },
  {
    key: "fno",
    label: "F&O",
    href: "/fno/alerts",
    tabs: [
      { href: "/fno/alerts", label: "AI F&O Alerts" },
      { href: "/fno/chain", label: "Option Chain" },
    ],
  },
  {
    key: "portfolio",
    label: "Portfolio",
    href: "/portfolio/holdings",
    tabs: [
      { href: "/portfolio/holdings", label: "Holdings" },
      { href: "/portfolio/positions", label: "Positions" },
      { href: "/portfolio/orders", label: "Orders" },
      { href: "/portfolio/history", label: "History" },
      { href: "/portfolio/analysis", label: "Analysis" },
    ],
  },
];

export function sectionForPath(pathname: string): Section | undefined {
  return SECTIONS.find((s) => pathname.startsWith("/" + s.key));
}
