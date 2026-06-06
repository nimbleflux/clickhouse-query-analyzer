import { useCallback, useEffect, useRef, useState } from "react";
import { instance } from "@viz-js/viz";
import type { Viz } from "@viz-js/viz";
import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";
import { AlertCircle, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface PipelineDiagramProps {
  dot: string;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const FIT_PADDING = 0.92;

function stripInlineColors(svg: SVGSVGElement) {
  const outerBg = svg.querySelector("g > polygon[fill='white']");
  if (outerBg) outerBg.remove();

  svg.querySelectorAll<SVGPolygonElement>(".node > polygon").forEach((el) => {
    el.removeAttribute("fill");
    el.removeAttribute("stroke");
  });
  svg.querySelectorAll<SVGPolygonElement>(".cluster > polygon").forEach((el) => {
    el.removeAttribute("fill");
    el.removeAttribute("stroke");
  });
  svg.querySelectorAll<SVGPathElement>(".edge path").forEach((el) => {
    el.removeAttribute("stroke");
  });
  svg.querySelectorAll<SVGPolygonElement>(".edge polygon").forEach((el) => {
    el.removeAttribute("fill");
    el.removeAttribute("stroke");
  });
  svg.querySelectorAll<SVGTextElement>("text").forEach((el) => {
    el.removeAttribute("fill");
    el.setAttribute("font-family", "inherit");
    el.removeAttribute("font-size");
  });

  svg.classList.add("pipeline-diagram");
}

export function PipelineDiagram({ dot }: PipelineDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const fitInView = useCallback(() => {
    const pz = panzoomRef.current;
    const container = containerRef.current;
    const svg = wrapperRef.current?.querySelector("svg");
    if (!pz || !container || !svg) return;

    const vb = (svg as SVGSVGElement).viewBox.baseVal;
    const naturalWidth = vb.width || svg.getBoundingClientRect().width;
    const naturalHeight = vb.height || svg.getBoundingClientRect().height;
    if (!naturalWidth || !naturalHeight) return;

    const scaleX = container.clientWidth / naturalWidth;
    const scaleY = container.clientHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY) * FIT_PADDING;

    // Panzoom transform is: scale(s) translate(x, y) with origin 0 0.
    // Element appears at position (s*x, s*y) with rendered size (s*w, s*h).
    // To center: s*x = (cw - s*w)/2, so x = (cw - s*w) / (2*s).
    const panX = (container.clientWidth - naturalWidth * scale) / (2 * scale);
    const panY = (container.clientHeight - naturalHeight * scale) / (2 * scale);

    pz.zoom(scale, { animate: false });
    pz.pan(panX, panY, { animate: false });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let wheelListener: ((e: WheelEvent) => void) | null = null;
    setError(null);
    setReady(false);

    (async () => {
      try {
        const viz: Viz = await instance();
        if (cancelled) return;
        const svg = viz.renderSVGElement(dot);
        const vb = svg.viewBox.baseVal;
        svg.style.width = `${vb.width}px`;
        svg.style.height = `${vb.height}px`;
        svg.style.maxWidth = "none";
        svg.style.display = "block";
        svg.style.transformOrigin = "0 0";

        stripInlineColors(svg);

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
        setError(e instanceof Error ? e.message : String(e));
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
  }, [dot, fitInView]);

  const zoomIn = useCallback(() => panzoomRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => panzoomRef.current?.zoomOut(), []);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <AlertCircle className="h-5 w-5 text-[var(--color-warning)]" />
        <p className="text-xs text-[var(--color-text-secondary)]">Failed to render pipeline diagram.</p>
        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-[var(--color-text-secondary)] opacity-70">{error}</pre>
      </div>
    );
  }

  return (
    <div className="relative">
      <style>{`
        .pipeline-diagram {
          font-family: var(--font-sans);
          font-size: 12px;
        }
        .pipeline-diagram text {
          fill: var(--color-text-primary);
        }
        .pipeline-diagram .node > polygon {
          fill: var(--surface-card);
          stroke: var(--color-border);
          stroke-width: 1;
        }
        .pipeline-diagram .cluster > polygon {
          fill: var(--surface-subtle);
          stroke: var(--color-border);
          stroke-width: 1;
          stroke-dasharray: 3 2;
        }
        .pipeline-diagram .cluster > text {
          fill: var(--color-text-secondary);
          font-weight: 600;
          font-size: 11px;
        }
        .pipeline-diagram .edge path {
          stroke: var(--color-text-secondary);
          stroke-width: 1.4;
          fill: none;
        }
        .pipeline-diagram .edge polygon {
          fill: var(--color-text-secondary);
          stroke: var(--color-text-secondary);
        }
        .pipeline-diagram .edge text {
          fill: var(--color-text-secondary);
          font-size: 10px;
        }
      `}</style>
      <div
        ref={containerRef}
        className="h-[420px] overflow-hidden rounded border border-[var(--color-border)] bg-[var(--surface-base)]"
      >
        <div ref={wrapperRef} className="invisible" />
      </div>
      {ready && (
        <div className="absolute right-2 top-2 flex flex-col gap-1 rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] p-1 shadow-sm">
          <button
            type="button"
            onClick={zoomIn}
            title="Zoom in"
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            title="Zoom out"
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={fitInView}
            title="Fit to view"
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <p className="mt-2 text-[10px] text-[var(--color-text-secondary)] opacity-70">
        Scroll to zoom, drag to pan.
      </p>
    </div>
  );
}
