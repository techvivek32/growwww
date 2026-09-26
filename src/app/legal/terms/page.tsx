import type { Metadata } from "next";
import PublicShell, { LegalArticle } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Terms of Service · MNHA Financials",
  description: "The terms that govern your use of the MNHA Financials terminal.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[17px] font-semibold tracking-tight text-ink">{children}</h2>;
}

export default function TermsPage() {
  return (
    <PublicShell>
      <LegalArticle title="Terms of Service" updated="September 2026">
        <p>
          These terms govern your use of MNHA Financials (&ldquo;the Service&rdquo;), a decision-support trading
          terminal that connects to your own brokerage account. By creating an account or using the Service, you
          agree to them. If you do not agree, do not use the Service.
        </p>

        <div className="space-y-2">
          <H>1. What the Service is — and is not</H>
          <p>
            MNHA Financials is software that reads your brokerage account and helps you act on it. It is <strong>not</strong>{" "}
            a broker, a bank, a portfolio manager, or an investment adviser. It does not hold your money or your
            securities — those remain with your broker (Groww) at all times. It is not registered with SEBI as a
            Research Analyst or an Investment Adviser, and nothing it displays is personalised investment advice or a
            recommendation to buy or sell any security.
          </p>
        </div>

        <div className="space-y-2">
          <H>2. Your account and your broker connection</H>
          <p>
            You are responsible for the security of your login and for the brokerage API credentials you connect. You
            confirm that any account you connect is your own and that you are authorised to trade it. You may
            disconnect your broker or delete your account at any time from Settings.
          </p>
        </div>

        <div className="space-y-2">
          <H>3. Orders are yours</H>
          <p>
            Every order is placed on your own brokerage account and requires your explicit, two-step confirmation. You
            decide what to trade, in what size, and when. You are solely responsible for your orders and their
            outcomes. The Service may fail, be delayed, or display stale data; you must verify anything material with
            your broker before acting on it.
          </p>
        </div>

        <div className="space-y-2">
          <H>4. No guarantee of results</H>
          <p>
            Signals, backtests and statistics are generated mechanically from historical and live market data. Past
            performance does not predict future results. The Service makes no promise of profit and no promise against
            loss. Trading in equities and derivatives carries substantial risk, including the loss of your entire
            capital. See our <a href="/legal/risk-disclosure" className="text-brandtext hover:opacity-75">Risk Disclosure</a>.
          </p>
        </div>

        <div className="space-y-2">
          <H>5. Acceptable use</H>
          <p>
            Do not misuse the Service: no attempts to break its security, access other users&apos; data, scrape it at
            scale, or use it to violate any law or your broker&apos;s own terms. We may suspend access that threatens
            the Service or other users.
          </p>
        </div>

        <div className="space-y-2">
          <H>6. Limitation of liability</H>
          <p>
            To the maximum extent permitted by law, the Service is provided &ldquo;as is&rdquo; without warranties of
            any kind. We are not liable for trading losses, missed trades, data errors, downtime, or any indirect or
            consequential damages arising from your use of the Service.
          </p>
        </div>

        <div className="space-y-2">
          <H>7. Changes and termination</H>
          <p>
            We may update these terms or the Service, and may discontinue features. Continued use after a change means
            you accept it. You may stop using the Service at any time.
          </p>
        </div>

        <div className="space-y-2">
          <H>8. Contact</H>
          <p>
            Questions about these terms? Reach us via the <a href="/legal/contact" className="text-brandtext hover:opacity-75">Contact</a> page.
          </p>
        </div>
      </LegalArticle>
    </PublicShell>
  );
}
