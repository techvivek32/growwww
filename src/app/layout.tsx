import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "@/components/TopNav";
import IndexStrip from "@/components/IndexStrip";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-jb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NOVA India — NSE trading terminal on Groww",
  description:
    "AI stock and F&O alerts for NSE with entry, target and stop on every setup, plus a live order desk on your own Groww account.",
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
    var s = localStorage.getItem('nova-theme');
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
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        <TopNav />
        <IndexStrip />
        <main className="mx-auto max-w-[1360px] px-4 py-6 lg:px-6 lg:py-8">{children}</main>
        <footer className="mx-auto max-w-[1360px] px-4 pb-10 lg:px-6">
          <p className="border-t border-line pt-5 text-[11px] leading-relaxed text-ink3">
            NOVA India is a decision-support terminal, not investment advice. Setups are generated from price and
            volume data and can be wrong. Orders route to your own Groww account — you place them, you own them.
            Currently running in <strong className="font-semibold text-ink2">paper mode</strong> with sample NSE data.
          </p>
        </footer>
      </body>
    </html>
  );
}
