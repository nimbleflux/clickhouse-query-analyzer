import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { instance } from "@viz-js/viz";
import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { AlertCircle, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { buildDot, buildAdjacency, computeHeat, type GraphTheme } from "../pages/schema-graph/dot";
import { renderGraphvizSVG } from "../pages/schema-graph/render";
import type { SchemaGraphData, SchemaKind } from "@/api/types";
import { useTheme } from "@/api/theme";

const MIN_SCALE = 0.08;
const MAX_SCALE = 8;
const FIT_PADDING = 0.92;

interface SchemaGraphViewProps {
  graph: SchemaGraphData;
  visibleKinds: Set<SchemaKind>;
  dbFilter: string | null;
  search: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Bumped by the parent to re-fit the view (e.g. after data reload). */
  fitSignal: number;
}

/** Resolve the CSS variables the DOT builder needs into concrete colors. */
function readGraphTheme(light: boolean): GraphTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    cardBg: v("--surface-card", light ? "#ffffff" : "#1a1d23"),
    border: v("--color-border", light ? "#d5d9e0" : "#2a2e36"),
    textPrimary: v("--color-text-primary", light ? "#1a1d23" : "#e6e8eb"),
    textSecondary: v("--color-text-secondary", light ? "#5b6470" : "#9aa1ab"),
    font: v("--font-sans", "system-ui, sans-serif"),
    light,
  };
}

export function SchemaGraphView({
  graph,
  visibleKinds,
  dbFilter,
  search,
  selectedKey,
  onSelect,
  fitSignal,
}: SchemaGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const naturalSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const theme = useTheme();

  const adjacency = useMemo(() => buildAdjacency(graph.edges), [graph.edges]);
  const heat = useMemo(() => computeHeat(graph), [graph]);
  const query = search.trim().toLowerCase();

  const fitInView = useCallback(() => {
    const pz = panzoomRef.current;
    const container = containerRef.current;
    const svg = wrapperRef.current?.querySelector("svg");
    if (!pz || !container || !svg) return;

    const naturalWidth = naturalSize.current.w || svg.getBoundingClientRect().width;
    const naturalHeight = naturalSize.current.h || svg.getBoundingClientRect().height;
    if (!naturalWidth || !naturalHeight) return;

    const scale = Math.min(container.clientWidth / naturalWidth, container.clientHeight / naturalHeight) * FIT_PADDING;
    const panX = (container.clientWidth - naturalWidth * scale) / (2 * scale);
    const panY = (container.clientHeight - naturalHeight * scale) / (2 * scale);
    pz.zoom(scale, { animate: false });
    pz.pan(panX, panY, { animate: false });
  }, []);

  // Rebuild whenever data, filters, selection-driven dimming, or theme change.
  const graphTheme = useMemo(() => readGraphTheme(theme === "light"), [theme]);
  const dot = useMemo(
    () => buildDot(graph, { theme: graphTheme, visibleKinds, dbFilter, heat }),
    [graph, graphTheme, visibleKinds, dbFilter, heat],
  );

  useEffect(() => {
    let cancelled = false;
    let wheelListener: ((e: WheelEvent) => void) | null = null;
    setError(null);
    setReady(false);

    (async () => {
      try {
        const viz = await instance();
        if (cancelled) return;
        const { svg, width: naturalWidth, height: naturalHeight } = await renderGraphvizSVG(viz, dot);
        naturalSize.current = { w: naturalWidth, h: naturalHeight };
        svg.style.width = `${naturalWidth}px`;
        svg.style.height = `${naturalHeight}px`;
        svg.style.maxWidth = "none";
        svg.style.display = "block";
        svg.style.transformOrigin = "0 0";
        svg.classList.add("schema-graph");

        // Graphviz puts the node/edge name in a <title> child — map rendered
        // elements back to graph entities so CSS can dim/highlight them.
        const kindByKey = new Map<string, SchemaKind>(graph.nodes.map((n) => [`${n.database}.${n.name}`, n.kind]));
        const edgeKind = new Map<string, string>(graph.edges.map((e) => [`${e.from}->${e.to}`, e.kind]));

        svg.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
          const title = g.querySelector("title")?.textContent ?? "";
          g.dataset.key = title;
          const kind = kindByKey.get(title);
          if (kind) g.dataset.kind = kind;
        });
        svg.querySelectorAll<SVGGElement>("g.edge").forEach((g) => {
          // Graphviz edge titles are "from->to" (no surrounding spaces).
          const title = (g.querySelector("title")?.textContent ?? "").replace(/\s+/g, "");
          const sep = title.indexOf("->");
          if (sep > 0) {
            g.dataset.from = title.slice(0, sep);
            g.dataset.to = title.slice(sep + 2);
            const kind = edgeKind.get(title);
            if (kind) g.classList.add(`ek-${kind}`);
          }
        });

        // Keep the design colors baked into the HTML-like labels; only drop
        // the white canvas polygon graphviz adds behind everything.
        const outerBg = svg.querySelector("g > polygon[fill='white']");
        if (outerBg) outerBg.remove();

        if (wrapperRef.current) {
          wrapperRef.current.replaceChildren(svg);
          requestAnimationFrame(() => {
            if (cancelled) return;
            if (containerRef.current && !panzoomRef.current) {
              panzoomRef.current = Panzoom(wrapperRef.current!, {
                maxScale: MAX_SCALE,
                minScale: MIN_SCALE,
                origin: "0 0",
                canvas: false,
              });
              wheelListener = panzoomRef.current.zoomWithWheel;
              containerRef.current.addEventListener("wheel", wheelListener);
            }
            fitInView();
            if (wrapperRef.current) wrapperRef.current.classList.remove("invisible");
            setReady(true);
          });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message + "\n--- stack ---\n" + (e.stack ?? "(none)") : String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (containerRef.current && wheelListener) {
        containerRef.current.removeEventListener("wheel", wheelListener);
      }
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
      if (wrapperRef.current) {
        wrapperRef.current.replaceChildren();
      }
    };
  }, [dot, fitInView, graph.nodes, graph.edges]);

  // Selection / search dimming via classes on the SVG root.
  useEffect(() => {
    const svg = wrapperRef.current?.querySelector("svg");
    if (!svg) return;
    svg.classList.toggle("has-selection", !!selectedKey);
    svg.classList.toggle("has-search", query.length > 0);

    svg.querySelectorAll<SVGGElement>("g.node").forEach((g) => {
      const key = g.dataset.key ?? "";
      const matches = query.length === 0 || key.toLowerCase().includes(query);
      g.classList.toggle("match", matches);
      g.classList.toggle("selected", key === selectedKey);
      const isNeighbor = !!selectedKey && adjacency.get(selectedKey)?.has(key);
      g.classList.toggle("neighbor", isNeighbor);
    });
    svg.querySelectorAll<SVGGElement>("g.edge").forEach((g) => {
      const touchesSelected =
        !!selectedKey && (g.dataset.from === selectedKey || g.dataset.to === selectedKey);
      g.classList.toggle("related", touchesSelected);
      const touchesMatch =
        query.length === 0 ||
        (g.dataset.from ?? "").toLowerCase().includes(query) ||
        (g.dataset.to ?? "").toLowerCase().includes(query);
      g.classList.toggle("match", touchesMatch);
    });
  }, [selectedKey, query, adjacency, ready, dot]);

  // Click handling: node → select; background → clear.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      const node = target.closest("g.node") as SVGGElement | null;
      if (node?.dataset.key) {
        onSelect(node.dataset.key === selectedKey ? null : node.dataset.key);
        return;
      }
      if (!target.closest("g.edge")) {
        onSelect(null);
      }
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [onSelect, selectedKey]);

  const zoomIn = useCallback(() => panzoomRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => panzoomRef.current?.zoomOut(), []);

  // Re-fit when the parent asks (data reload, filter change).
  useEffect(() => {
    if (fitSignal > 0 && ready) fitInView();
  }, [fitSignal, ready, fitInView]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <AlertCircle className="h-5 w-5 text-[var(--color-warning)]" />
        <p className="text-xs text-[var(--color-text-secondary)]">Failed to render the schema graph.</p>
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--color-text-secondary)] opacity-70">{error}</pre>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <style>{`
        .schema-graph {
          font-family: var(--font-sans);
        }
        .schema-graph g.node {
          cursor: pointer;
          transition: opacity 0.2s ease;
        }
        .schema-graph g.node > title,
        .schema-graph g.edge > title {
          display: none;
        }
        .schema-graph g.edge {
          transition: opacity 0.2s ease;
        }
        .schema-graph g.edge path {
          fill: none;
        }
        .schema-graph g.edge.ek-mv path { stroke: #a855f7; stroke-width: 1.6; }
        .schema-graph g.edge.ek-mv polygon { fill: #a855f7; stroke: #a855f7; }
        .schema-graph g.edge.ek-dict path { stroke: #f59e0b; stroke-dasharray: 2 3; }
        .schema-graph g.edge.ek-dict polygon { fill: #f59e0b; stroke: #f59e0b; }
        .schema-graph g.edge.ek-distributed path { stroke: #f97316; stroke-dasharray: 6 3; }
        .schema-graph g.edge.ek-distributed polygon { fill: #f97316; stroke: #f97316; }
        .schema-graph g.edge.ek-view path { stroke: #14b8a6; stroke-width: 1.1; stroke-dasharray: 4 3; }
        .schema-graph g.edge.ek-view polygon { fill: #14b8a6; stroke: #14b8a6; }
        .schema-graph.has-search g.node:not(.match),
        .schema-graph.has-selection g.node:not(.selected):not(.neighbor) {
          opacity: 0.15;
        }
        .schema-graph.has-search g.edge:not(.match),
        .schema-graph.has-selection g.edge:not(.related) {
          opacity: 0.08;
        }
        .schema-graph g.node:hover > * {
          filter: brightness(1.15);
        }
      `}</style>
      <div ref={containerRef} className="h-full overflow-hidden rounded border border-[var(--color-border)] bg-[var(--surface-base)]">
        <div ref={wrapperRef} className="invisible" />
      </div>
      {ready && (
        <div className="absolute right-2 top-2 flex flex-col gap-1 rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] p-1 shadow-sm">
          <button
            type="button"
            onClick={zoomIn}
            title="Zoom in"
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            title="Zoom out"
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fitInView}
            title="Fit to view"
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
