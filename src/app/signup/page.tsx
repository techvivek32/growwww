import type { Metadata } from "next";
import Link from "next/link";
import AuthShell from "@/components/public/AuthShell";
import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "Create your account · MNHA Financials",
  description: "Create a MNHA Financials account and connect your own Groww trading API.",
};

export default function SignupPage() {
  return (
    <AuthShell
      step={1}
      headerRight={
        <Link href="/login" className="border border-pub-cream px-4 py-2 text-[14px] font-medium text-pub-cream hover:bg-pub-cream hover:text-pub-ink">
          Sign in
        </Link>
      }
    >
      <p className="font-plex text-[11px] tracking-[0.12em] text-pub-coral uppercase">Step 01 · Your login</p>
      <h1 className="pub-display mt-4 text-[clamp(2.8rem,5vw,3.8rem)] leading-[0.98] text-pub-cream">
        Create your <em>account.</em>
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-pub-muted">
        An email and a password — your login to the desk. Next comes the agreement, then the guided Groww connection.
      </p>

      <SignupForm />

      <p className="mt-6 text-[14px] text-pub-muted">
        Already have one?{" "}
        <Link href="/login" className="text-pub-cream underline decoration-pub-accent decoration-2 underline-offset-4">
          Sign in
        </Link>
      </p>
      <p className="mt-10 border-t border-pub-hair pt-5 text-[12.5px] leading-relaxed text-pub-dim">
        By creating an account you accept the{" "}
        <Link href="/legal/terms" className="underline underline-offset-2 hover:text-pub-cream">terms</Link> and{" "}
        <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-pub-cream">privacy policy</Link>. MNHA
        is decision-support software, not investment advice; your Groww key is encrypted at rest and used only for your
        own account.
      </p>
    </AuthShell>
  );
}
