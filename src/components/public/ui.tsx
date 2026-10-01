import Link from "next/link";
import type { ReactNode } from "react";

/** Primitives for the editorial public site — square, hairline, no shadows. */

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[74rem] px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function Arrow() {
  return (
    <span className="pub-arrow" aria-hidden="true">
      →
    </span>
  );
}

/** "01  THE PATH" — mono number in coral, sans caps label, optional tag. */
export function Eyebrow({ n, children, tag }: { n?: string; children: ReactNode; tag?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-3 text-[12px] font-semibold tracking-[0.12em] text-pub-cream uppercase">
      {n && <span className="font-plex font-normal text-pub-coral">{n}</span>}
      <span>{children}</span>
      {tag && <Tag>{tag}</Tag>}
    </p>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="border border-pub-accent px-2 py-0.5 font-plex text-[10px] font-normal tracking-[0.12em] text-pub-coral uppercase">
      {children}
    </span>
  );
}

/** Serif heading; wrap the accent word in <em> for the italic. */
export function Display({
  as: As = "h2",
  children,
  className = "",
}: {
  as?: "h1" | "h2" | "h3" | "p";
  children: ReactNode;
  className?: string;
}) {
  return <As className={`pub-display ${className}`}>{children}</As>;
}

const BTN = {
  cream: "bg-pub-cream text-pub-ink hover:bg-white",
  ink: "bg-pub-ink text-pub-paper hover:bg-black",
  ghost: "border border-pub-cream text-pub-cream hover:bg-pub-cream hover:text-pub-ink",
} as const;

export function Button({
  href,
  children,
  variant = "cream",
  size = "lg",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BTN;
  size?: "sm" | "lg";
  className?: string;
}) {
  const pad = size === "lg" ? "px-6 py-4 text-[16px]" : "px-4 py-2 text-[14px]";
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 font-medium transition-colors ${pad} ${BTN[variant]} ${className}`}>
      {children}
      {size === "lg" && <Arrow />}
    </Link>
  );
}

/** Text link with the 2px accent underline. */
export function TextLink({
  href,
  children,
  tone = "cream",
  external = false,
}: {
  href: string;
  children: ReactNode;
  tone?: "cream" | "ink";
  external?: boolean;
}) {
  const cls = `inline-flex items-center gap-2 text-[15px] font-medium underline decoration-pub-accent decoration-2 underline-offset-[7px] transition-opacity hover:opacity-80 ${
    tone === "ink" ? "text-pub-ink" : "text-pub-cream"
  }`;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children} <span aria-hidden="true">↗</span>
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children} <Arrow />
    </Link>
  );
}

/** Mono, uppercase, tracked label. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-plex text-[11px] tracking-[0.1em] uppercase ${className}`}>{children}</span>;
}
