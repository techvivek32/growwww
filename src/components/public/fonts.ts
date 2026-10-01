import { Instrument_Serif, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";

/**
 * The public site's type: a condensed editorial serif for display, its sans
 * companion for text, and a plain mono for labels and figures. Loaded only
 * where a public page renders — the terminal keeps Inter / JetBrains Mono.
 */
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-iserif",
  display: "swap",
});
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-isans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plexmono", display: "swap" });

/** Put on the `.pub` wrapper so the CSS variables resolve inside it. */
export const pubFonts = `${serif.variable} ${sans.variable} ${mono.variable}`;
