import { redirect } from "next/navigation";
import { getAccount } from "@/lib/api/broker";
import { currentUserId } from "@/lib/session";
import { hasBroker } from "@/lib/users";
import { unreadCount } from "@/lib/notifications";
import { OWNER_ID } from "@/lib/auth";
import TopNav from "@/components/TopNav";
import IndexStrip from "@/components/IndexStrip";
import { AutoTradeProvider } from "@/components/AutoTrade";
import { LiveTicksProvider } from "@/components/LiveTicks";

// The nav shows live account state.
export const dynamic = "force-dynamic";

/**
 * The terminal chrome. Everything behind the session lives in this group;
 * /login sits outside it and gets the bare root layout instead.
 *
 * The account is read here, on the server, and handed to the client nav as
 * props — the nav never reaches for broker data itself.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A registered user with no broker connected has an empty terminal — send
  // them to connect one first. (The owner uses the env house account.)
  const uid = await currentUserId();
  if (!uid) redirect("/login");
  if (uid !== OWNER_ID && !(await hasBroker(uid))) redirect("/connect-broker");

  const [account, unread] = await Promise.all([getAccount(), unreadCount(uid)]);

  return (
    <AutoTradeProvider>
      <LiveTicksProvider>
      <TopNav account={account} connected={account.balance !== null} isOwner={uid === OWNER_ID} unread={unread} />
      <IndexStrip />
      <main className="mx-auto max-w-[1360px] px-4 py-6 lg:px-6 lg:py-8">{children}</main>
      <footer className="mx-auto max-w-[1360px] px-4 pb-10 lg:px-6">
        <p className="border-t border-line pt-5 text-[11.5px] leading-relaxed text-ink3">
          MNHA Financials is a decision-support terminal, not investment advice. Setups are generated from price and
          volume data and can be wrong. Orders you confirm here are placed on your own Groww account — you place
          them, you own them.
        </p>
      </footer>
      </LiveTicksProvider>
    </AutoTradeProvider>
  );
}
