"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the server-rendered page every `every` ms while the tab is visible, for the live scalp books. */
export default function AutoRefresh({ every = 5000 }: { every?: number }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setTick((t) => t + 1);
      }
    }, every);
    return () => clearInterval(id);
  }, [router, every]);
  return (
    <span className="font-mono text-[10.5px] tracking-[0.08em] text-ink3 uppercase" title={`refreshed ${tick} times`}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-up align-middle" /> live · refreshes every {Math.round(every / 1000)} s
    </span>
  );
}
