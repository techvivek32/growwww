import type { Metadata } from "next";
import PublicShell, { LegalArticle } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Privacy Policy · MNHA Financials",
  description: "What MNHA Financials collects, how it is stored, and your choices.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[17px] font-semibold tracking-tight text-ink">{children}</h2>;
}

export default function PrivacyPage() {
  return (
    <PublicShell>
      <LegalArticle title="Privacy Policy" updated="September 2026">
        <p>This policy explains what MNHA Financials collects, why, how it is protected, and the control you have.</p>

        <div className="space-y-2">
          <H>What we collect</H>
          <p>
            <strong>Account details:</strong> your email address and a password (stored only as a salted scrypt hash,
            never in plain text).<br />
            <strong>Broker credentials:</strong> the Groww API key and TOTP secret you choose to connect, stored
            <strong> encrypted at rest with AES-256-GCM</strong>. They are used only to read your account and place the
            orders you confirm.<br />
            <strong>Identity-verification data (only if you submit it):</strong> your full name, PAN, date of birth,
            address, a selfie, and any ID document you upload — used solely to verify your identity. PAN and date of
            birth are stored encrypted; the selfie and documents are stored outside the public web and are viewable
            only by you and the reviewer. This is MNHA&apos;s own internal check, not a government or SEBI KYC.<br />
            <strong>Usage data:</strong> your notifications and the screens you use, to run the product.
          </p>
        </div>

        <div className="space-y-2">
          <H>What we do NOT do</H>
          <p>
            We do not sell your data. We do not share your brokerage credentials with anyone. We do not place any order
            without your explicit confirmation. Your password and decrypted keys are never sent to your browser.
          </p>
        </div>

        <div className="space-y-2">
          <H>How it is stored</H>
          <p>
            Data is held on the server that runs the Service. Passwords are hashed; broker credentials are encrypted
            with a key derived from a server secret that is not stored alongside the data. Access is over HTTPS.
          </p>
        </div>

        <div className="space-y-2">
          <H>Your choices</H>
          <p>
            You can disconnect your broker (which removes the stored credentials) or delete your account entirely from
            Settings at any time. Deleting your account removes your stored data — including any identity-verification
            details, selfie and documents — from the Service.
          </p>
        </div>

        <div className="space-y-2">
          <H>Third parties</H>
          <p>
            The Service talks to Groww&apos;s official API on your behalf and reads public market data. Their handling
            of data is governed by their own policies.
          </p>
        </div>

        <div className="space-y-2">
          <H>Contact</H>
          <p>
            Privacy questions or a data-deletion request? Use the{" "}
            <a href="/legal/contact" className="text-brandtext hover:opacity-75">Contact</a> page.
          </p>
        </div>
      </LegalArticle>
    </PublicShell>
  );
}
