import type { Metadata } from "next";
import PublicShell, { LegalArticle } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Contact · MNHA Financials",
  description: "How to reach MNHA Financials.",
};

export default function ContactPage() {
  return (
    <PublicShell>
      <LegalArticle title="Contact" updated="September 2026">
        <p>
          MNHA Financials is an independent trading terminal. For support, privacy or data-deletion requests, or
          questions about the terms, reach out below.
        </p>
        <div className="rounded-xl border border-line bg-surface p-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <p className="text-[13px] font-semibold text-ink3 uppercase tracking-wide">Email</p>
          <a href="mailto:support@visionmarket.in" className="mt-1 block text-[16px] font-semibold text-brandtext hover:opacity-75">
            support@visionmarket.in
          </a>
        </div>
        <p className="text-[12.5px] text-ink3">
          We aim to respond within a couple of business days. For anything about your brokerage account, your money or
          your positions, contact Groww directly — MNHA Financials cannot access or move funds.
        </p>
      </LegalArticle>
    </PublicShell>
  );
}
