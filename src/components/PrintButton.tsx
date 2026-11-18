"use client";

/** Opens the browser's print dialog — "Save as PDF" gives the report as a PDF file. */
export default function PrintButton({ label = "Save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-bg transition-opacity hover:opacity-85 print:hidden"
    >
      {label}
    </button>
  );
}
