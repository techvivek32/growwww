"use client";

import { useEffect, useRef } from "react";

/**
 * TradingView's free advanced-chart widget — the same engine Groww's own
 * Terminal embeds. The script comes from TradingView's CDN; everything else
 * on the page stays ours.
 */
export default function TradingViewChart({ tvSymbol }: { tvSymbol: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = "";

    const container = document.createElement("div");
    container.className = "tradingview-widget-container__widget";
    container.style.height = "100%";
    container.style.width = "100%";
    el.appendChild(container);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: tvSymbol,
      interval: "5",
      timezone: "Asia/Kolkata",
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      style: "1",
      locale: "en",
      hide_side_toolbar: false,
      allow_symbol_change: true,
      withdateranges: true,
      details: false,
      autosize: true,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);

    return () => {
      el.innerHTML = "";
    };
  }, [tvSymbol]);

  return (
    <div
      ref={host}
      className="tradingview-widget-container h-full w-full"
      style={{ minHeight: 480 }}
    />
  );
}
