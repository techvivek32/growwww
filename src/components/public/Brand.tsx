/**
 * The MNHA mark: three stepped, slanted bars — a rising chart read as a stack.
 * `tone` picks cream (on ink), ink (on cream/paper) or the art colours.
 */
export function LogoMark({ tone = "cream", size = 26 }: { tone?: "cream" | "ink" | "art"; size?: number }) {
  const fills =
    tone === "art" ? ["#4A615C", "#CE431D", "#E8AF7E"] : tone === "ink" ? ["#15140f", "#15140f", "#15140f"] : ["#eee9dd", "#eee9dd", "#eee9dd"];
  return (
    <svg width={size} height={(size * 24) / 28} viewBox="0 0 28 24" aria-hidden="true" focusable="false">
      <path d="M2 22h15l4-5H6Z" fill={fills[0]} />
      <path d="M5 14.5h15l4-5H9Z" fill={fills[1]} />
      <path d="M8 7h15l4-5H12Z" fill={fills[2]} />
    </svg>
  );
}

/** "MNHA" in the display serif with an italic "Financials". */
export function Wordmark({ tone = "cream", className = "" }: { tone?: "cream" | "ink"; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark tone={tone} />
      <span className={`pub-display text-[22px] leading-none whitespace-nowrap sm:text-[25px] ${tone === "ink" ? "text-pub-ink" : "text-pub-cream"}`}>
        MNHA <em className={tone === "cream" ? "max-[379px]:hidden" : ""}>Financials</em>
      </span>
    </span>
  );
}
