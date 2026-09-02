import type { ReactNode } from "react";

/**
 * Wide tables must scroll inside themselves — the page body should never
 * scroll horizontally on a phone.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-line bg-surface"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <table className="w-full min-w-[720px] border-collapse text-left">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 border-b border-line bg-surface2 px-4 py-3 text-[11px] font-semibold tracking-wider text-ink3 uppercase ${a} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const a = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <td className={`border-b border-line px-4 py-3 text-[13px] text-ink2 ${a} ${className}`}>{children}</td>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="transition-colors last:[&>td]:border-0 hover:bg-surfaceh">{children}</tr>;
}
