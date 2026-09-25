import type { Metadata } from "next";
import { getOptionChain, getAccount, isConnected, canTrade } from "@/lib/api/broker";
import { PageHead } from "@/components/ui";
import ChainBoard from "@/components/ChainBoard";
import NotConnected from "@/components/NotConnected";

export const metadata: Metadata = { title: "Option Chain · MNHA Financials" };

// Live FNO quotes and the live account — never bake this at build time.
export const dynamic = "force-dynamic";

export default async function OptionChainPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; e?: string }>;
}) {
  const params = await searchParams;
  const [chain, account] = await Promise.all([
    getOptionChain(params.u, params.e),
    getAccount(),
  ]);

  if (!chain) {
    return (
      <>
        <PageHead title="Option chain" sub="Live strikes, premiums and open interest." />
        <NotConnected
          connected={isConnected()}
          what={isConnected() ? "The chain could not be loaded" : "No option chain available"}
          detail={
            isConnected()
              ? "The strike grid comes from the instrument master and prices from the live feed; one of the two did not answer just now. Reload to retry."
              : "Option quotes come from your Groww account's live feed once credentials are configured on the server."
          }
        />
      </>
    );
  }

  return <ChainBoard chain={chain} balance={account.balance} tradable={canTrade()} />;
}
