import type { Metadata } from "next";
import PublicShell, { LegalArticle } from "@/components/PublicShell";
import { CONTRACT, AGREEMENT_VERSION } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Privacy Policy · MNHA Financials",
  description: "What MNHA Financials collects, where it is stored, how long it is kept, and your choices.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[17px] font-semibold tracking-tight text-ink">{children}</h2>;
}

/** The data sections of the user agreement — one text, so the two never disagree. */
const DATA_SECTIONS = new Set([1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]);

export default function PrivacyPage() {
  const sections = CONTRACT.en.sections.filter((s) => DATA_SECTIONS.has(Number.parseInt(s.heading, 10)));
  return (
    <PublicShell>
      <LegalArticle title="Privacy Policy" updated={`October 2026 · agreement ${AGREEMENT_VERSION}`}>
        <p>
          This policy is the data part of the MNHA Financials user agreement, shown here word for word. Every user
          reads it, and gives separate consents, before an account is used. It is also available in हिन्दी and
          ગુજરાતી on the agreement page.
        </p>
        {sections.map((s) => (
          <div key={s.heading} className="space-y-2">
            <H>{s.heading.replace(/^\d+\.\s*/, "")}</H>
            <p>{s.body}</p>
          </div>
        ))}
      </LegalArticle>
    </PublicShell>
  );
}
