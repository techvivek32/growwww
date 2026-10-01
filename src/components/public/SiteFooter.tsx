import Link from "next/link";
import { LogoMark } from "./Brand";

const COLS: { head: string; links: [string, string][] }[] = [
  {
    head: "Product",
    links: [
      ["/#path", "How it works"],
      ["/#desk", "The desk"],
      ["/#try", "Risk maths"],
      ["/#membership", "Membership"],
      ["/#faq", "Questions"],
    ],
  },
  {
    head: "Account",
    links: [
      ["/signup", "Create an account"],
      ["/login", "Sign in"],
      ["/connect-broker", "Connect Groww"],
    ],
  },
  {
    head: "Legal",
    links: [
      ["/legal/terms", "Terms of use"],
      ["/legal/privacy", "Privacy"],
      ["/legal/risk-disclosure", "Risk disclosure"],
      ["/legal/contact", "Contact"],
    ],
  },
];

/** Cream footer with the legal disclaimer and a giant, clipped wordmark. */
export default function SiteFooter() {
  return (
    <footer className="overflow-hidden bg-pub-cream text-pub-ink">
      <div className="mx-auto w-full max-w-[74rem] px-4 pt-16 sm:px-6 sm:pt-20">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <LogoMark tone="ink" size={30} />
            <p className="pub-display mt-5 max-w-sm text-[28px] leading-[1.05]">
              Measure the edge. Then take the trade <em>yourself.</em>
            </p>
            <p className="mt-5 font-plex text-[10.5px] tracking-[0.12em] text-[#6d685d] uppercase">
              Your account · Your orders · No guaranteed returns
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-7">
            {COLS.map((c) => (
              <div key={c.head}>
                <p className="border-b border-pub-ink/20 pb-2 font-plex text-[10.5px] tracking-[0.12em] text-[#6d685d] uppercase">
                  {c.head}
                </p>
                <ul className="mt-4 space-y-3 text-[14px]">
                  {c.links.map(([href, label]) => (
                    <li key={href}>
                      <Link href={href} className="hover:underline hover:decoration-pub-accent hover:decoration-2 hover:underline-offset-4">
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-6 border-t border-pub-ink/15 pt-6 lg:flex-row lg:items-start lg:justify-between">
          <p className="max-w-[48rem] text-[12px] leading-relaxed text-[#5f5a50]">
            MNHA Financials is decision-support software, not a broker and not an investment adviser. It is not
            registered with SEBI as a Research Analyst or Investment Adviser, and nothing on this site is a
            recommendation to buy or sell any security. Setups are generated from price and volume data and can be
            wrong; past or backtested results do not predict future results. Trading in equities and derivatives
            carries a risk of loss — SEBI&apos;s own studies found roughly 9 in 10 individual F&amp;O traders lost
            money. Orders you confirm are placed on your own Groww account through Groww&apos;s official API.
            &ldquo;Groww&rdquo; is a trademark of its owner; MNHA Financials is independent and is not affiliated
            with or endorsed by it.
          </p>
          <p className="shrink-0 font-plex text-[10.5px] tracking-[0.12em] text-[#6d685d] uppercase lg:text-right">
            © {new Date().getFullYear()} MNHA Financials
            <br />
            Built to be honest about risk
          </p>
        </div>
      </div>

      <p
        aria-hidden="true"
        className="pub-display mt-10 -mb-[0.2em] px-3 text-[12vw] leading-[0.8] whitespace-nowrap select-none sm:px-6 lg:text-[13.5vw]"
      >
        MNHA <em>Financials</em>
      </p>
    </footer>
  );
}
