import TopNav from "@/components/TopNav";
import IndexStrip from "@/components/IndexStrip";
import { AutoTradeProvider } from "@/components/AutoTrade";

/**
 * The terminal chrome. Everything behind the session lives in this group;
 * /login sits outside it and gets the bare root layout instead.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AutoTradeProvider>
      <TopNav />
      <IndexStrip />
      <main className="mx-auto max-w-[1360px] px-4 py-6 lg:px-6 lg:py-8">{children}</main>
      <footer className="mx-auto max-w-[1360px] px-4 pb-10 lg:px-6">
        <p className="border-t border-line pt-5 text-[11px] leading-relaxed text-ink3">
          MNHA Financials is a decision-support terminal, not investment advice. Setups are
          generated from price and volume data and can be wrong. Orders route to your own Groww
          account — you place them, you own them.
        </p>
      </footer>
    </AutoTradeProvider>
  );
}
