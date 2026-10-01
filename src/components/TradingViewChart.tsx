"use client";

import { useEffect, useRef } from "react";

/**
 * TradingView's free advanced-chart widget. The script comes from
 * TradingView's CDN; everything else on the page stays ours.
 *
 * The widget is painted on the terminal's own surface and hairline colours
 * (read from the theme tokens), and rebuilt when the theme flips — its
 * light/dark choice is fixed at creation, so a toggle needs a fresh embed.
 */
export default function TradingViewChart({ tvSymbol }: { tvSymbol: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = document.documentElement;

    const build = () => {
      el.innerHTML = "";

      const container = document.createElement("div");
      container.className = "tradingview-widget-container__widget";
      container.style.height = "100%";
      container.style.width = "100%";
      el.appendChild(container);

      const css = getComputedStyle(root);
      const surface = css.getPropertyValue("--c-surface").trim();
      const hairline = css.getPropertyValue("--c-border").trim();

      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.async = true;
      script.innerHTML = JSON.stringify({
        symbol: tvSymbol,
        interval: "5",
        timezone: "Asia/Kolkata",
        theme: root.classList.contains("dark") ? "dark" : "light",
        style: "1",
        locale: "en",
        hide_side_toolbar: false,
        allow_symbol_change: true,
        withdateranges: true,
        details: false,
        autosize: true,
        ...(surface ? { backgroundColor: surface } : {}),
        ...(hairline ? { gridColor: hairline } : {}),
        support_host: "https://www.tradingview.com",
      });
      el.appendChild(script);
    };

    build();

    let dark = root.classList.contains("dark");
    const watch = new MutationObserver(() => {
      const now = root.classList.contains("dark");
      if (now === dark) return;
      dark = now;
      build();
    });
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      watch.disconnect();
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
