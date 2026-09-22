import type { ReactNode } from "react";

/**
 * Groww's table: hairline border, sentence-case grey headers (never shouty
 * uppercase), and tall airy rows. Wide tables scroll inside themselves — the
 * page body must never scroll sideways.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
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
      className={`sticky top-0 z-10 border-b border-line bg-surface px-4 py-3.5 text-[12.5px] font-medium whitespace-nowrap text-ink3 ${a} ${className}`}
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
  return <td className={`border-b border-line px-4 py-4 text-[13.5px] text-ink2 ${a} ${className}`}>{children}</td>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="transition-colors last:[&>td]:border-0 hover:bg-surfaceh">{children}</tr>;
}
