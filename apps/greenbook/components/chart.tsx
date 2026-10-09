"use client";

import { useEffect, useRef } from "react";
import { moneyCompact, moneyFull, countFull } from "@/lib/format";

export interface ChartSpec {
  kind: "bar" | "line" | "pie" | "scatter";
  title?: string;
  x_label?: string;
  y_label?: string;
  y_unit?: "usd" | "count";
  categories: string[];
  series: { name: string; data: number[] }[];
}

/** Read Greenbook tokens at render time so charts re-theme with the mode. */
function tokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    ink1: v("--ink-1"),
    ink3: v("--ink-3"),
    border1: v("--border-1"),
    border2: v("--border-2"),
    overlay: v("--bg-overlay"),
    accent: v("--accent"),
    fills: [v("--cat-equity-fill"), v("--cat-grant-fill"), v("--cat-federal-fill"), v("--ink-3"), v("--accent")],
    mono: s.getPropertyValue("--font-jetbrains").trim() || "monospace",
  };
}

export function Chart({ spec, height = 280 }: { spec: ChartSpec; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let chart: { setOption: (o: unknown) => void; dispose: () => void; resize: () => void } | null =
      null;
    let observer: MutationObserver | null = null;
    let onResize: (() => void) | null = null;

    (async () => {
      const [{ init, use }, charts, components, renderer] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      use([
        charts.BarChart,
        charts.LineChart,
        charts.PieChart,
        charts.ScatterChart,
        components.GridComponent,
        components.TooltipComponent,
        components.LegendComponent,
        renderer.CanvasRenderer,
      ]);
      if (disposed || !ref.current) return;
      chart = init(ref.current);

      const render = () => {
        const t = tokens();
        const fmt = (val: number) =>
          spec.y_unit === "usd" ? moneyCompact(val) : countFull(val);
        const fmtFull = (val: number) =>
          spec.y_unit === "usd" ? moneyFull(val) : countFull(val);
        const isPie = spec.kind === "pie";
        const multi = spec.series.length > 1;

        chart!.setOption(
          {
            animationDuration: 200,
            textStyle: { fontFamily: t.mono, fontSize: 11 },
            grid: { left: 8, right: 16, top: multi ? 40 : 16, bottom: 28, containLabel: true },
            tooltip: {
              trigger: isPie ? "item" : "axis",
              backgroundColor: t.overlay,
              borderColor: t.border1,
              textStyle: { color: t.ink1, fontFamily: t.mono, fontSize: 12 },
              axisPointer: { type: "line", lineStyle: { color: t.border2 } },
              valueFormatter: (v: number) => fmtFull(v),
            },
            legend: multi
              ? { top: 0, left: 0, icon: "rect", itemWidth: 8, itemHeight: 8, textStyle: { color: t.ink3, fontSize: 11 } }
              : undefined,
            ...(isPie
              ? {}
              : {
                  xAxis: {
                    type: "category",
                    data: spec.categories,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { color: t.ink3, fontSize: 11 },
                  },
                  yAxis: {
                    type: "value",
                    splitLine: { lineStyle: { color: t.border1, width: 1 } },
                    axisLabel: { color: t.ink3, fontSize: 11, formatter: fmt },
                  },
                }),
            series: isPie
              ? [
                  {
                    type: "pie",
                    radius: ["44%", "72%"],
                    itemStyle: { borderColor: "transparent", borderWidth: 2 },
                    label: { color: t.ink3, fontSize: 11 },
                    data: spec.categories.map((c, i) => ({
                      name: c,
                      value: spec.series[0]?.data[i] ?? 0,
                      itemStyle: { color: t.fills[i % t.fills.length] },
                    })),
                  },
                ]
              : spec.series.map((srs, i) => ({
                  name: srs.name,
                  type: spec.kind,
                  data: srs.data,
                  itemStyle: {
                    color: t.fills[i % t.fills.length],
                    borderRadius: spec.kind === "bar" ? [2, 2, 0, 0] : 0,
                  },
                  lineStyle: { width: 2, color: t.fills[i % t.fills.length] },
                  symbol: spec.kind === "scatter" ? "circle" : "none",
                  symbolSize: 8,
                  emphasis: { focus: "series" },
                })),
          },
          // ECharts option merge quirk: replace wholesale so theme flips clean.
        );
      };

      render();
      observer = new MutationObserver(render);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      onResize = () => chart?.resize();
      window.addEventListener("resize", onResize);
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (onResize) window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec)]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
