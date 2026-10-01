import type { Metadata } from "next";
import Link from "next/link";
import AuthShell from "@/components/public/AuthShell";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · MNHA Financials",
  description: "Sign in to the MNHA Financials NSE terminal.",
};

const NOTE = (
  <div className="w-full max-w-[21rem] bg-pub-paper p-5 text-pub-ink">
    <p className="border-b border-pub-ink pb-2.5 font-plex text-[10.5px] tracking-[0.08em] text-[#6d685d] uppercase">Good to know</p>
    <ul className="text-[14px] leading-snug">
      <li className="border-b border-dashed border-[#d8d2c4] py-2.5">Sessions last eight hours, in an httpOnly cookie.</li>
      <li className="border-b border-dashed border-[#d8d2c4] py-2.5">Signing in or out never places or cancels an order.</li>
      <li className="py-2.5">Your money stays in your own Groww account.</li>
    </ul>
  </div>
);

export default function LoginPage() {
  return (
    <AuthShell
      aside={NOTE}
      headerRight={
        <Link href="/signup" className="bg-pub-cream px-4 py-2 text-[14px] font-medium text-pub-ink hover:bg-white">
          Get started
        </Link>
      }
    >
      <h1 className="pub-display text-[clamp(2.8rem,5vw,3.8rem)] leading-[0.98] text-pub-cream">
        Welcome <em>back.</em>
      </h1>
      <p className="mt-4 text-[16px] leading-relaxed text-pub-muted">Sign in to your desk.</p>

      <LoginForm />

      <p className="mt-6 text-[14px] text-pub-muted">
        New here?{" "}
        <Link href="/signup" className="text-pub-cream underline decoration-pub-accent decoration-2 underline-offset-4">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
