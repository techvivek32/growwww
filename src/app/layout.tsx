import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap" });

/** Canonical origin. Override per environment; falls back to the live domain. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://visionmarket.in";

const DESCRIPTION =
  "AI stock and F&O alerts for NSE with entry, target and stop on every setup, plus a live order desk on your own Groww account.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "MNHA Financials — NSE trading terminal on Groww",
  description: DESCRIPTION,
  applicationName: "MNHA Financials",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "MNHA Financials",
    title: "MNHA Financials — NSE trading terminal on Groww",
    description: DESCRIPTION,
    url: "/",
    locale: "en_IN",
  },
  // The terminal is behind a sign-in and holds one person's account data.
  // There is nothing here for a crawler, and a financial login page that
  // turns up in search results is exactly the shape abuse classifiers hunt.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1012" },
  ],
};

/**
 * Applied before first paint so a dark-theme viewer never sees a white flash.
 * Kept tiny and dependency-free on purpose.
 */
const themeScript = `
(function(){
  try {
    var s = localStorage.getItem('mnha-theme');
    var d = s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (d) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
