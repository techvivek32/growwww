import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-5 text-center">
      <div>
        <p className="text-[64px] font-bold leading-none tracking-tight text-brandtext">404</p>
        <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-ink">This page isn&apos;t here</h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-ink3">
          The link may be old or mistyped. The market, thankfully, is still where you left it.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="inline-flex h-11 items-center rounded-lg border border-line2 px-5 text-[14px] font-semibold text-ink hover:bg-surfaceh">Home</Link>
          <Link href="/stocks/alerts" className="inline-flex h-11 items-center rounded-lg bg-brand px-5 text-[14px] font-semibold text-white hover:bg-brandh">Open terminal</Link>
        </div>
      </div>
    </div>
  );
}
