import { useCallback, useRef, useEffect, useState } from "react";
import { useTheme } from "../api/theme";

interface FlameNode {
  name: string;
  value: number;
  x: number;
  width: number;
  depth: number;
}

interface FlameTreeNode {
  value: number;
  children: Map<string, FlameTreeNode>;
}

export function FlameGraph({ data }: { data: { name: string; value: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; value: number } | null>(null);
  const [nodes, setNodes] = useState<FlameNode[]>([]);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const [zoomPath, setZoomPath] = useState<string[]>([]);
  const theme = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);

  const ROW_HEIGHT = 20;
  const PADDING = 1;

  // Track container width via ResizeObserver so the flame graph fills
  // the available space (previously hard-coded to 1000px).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const buildNodes = useCallback(
    (rawData: { name: string; value: number }[], zoom: string[]): FlameNode[] => {
      if (rawData.length === 0) return [];

      // Build a tree from semicolon-delimited stack strings.
      const root: FlameTreeNode = { value: 0, children: new Map() };

      for (const d of rawData) {
        const parts = d.name.split(";").filter(Boolean);
        if (parts.length === 0) continue;

        // Apply zoom: skip stacks that don't start with the zoomed path,
        // and trim the zoomed prefix so the zoomed node becomes the new root.
        if (zoom.length > 0) {
          if (zoom.length > parts.length) continue;
          let matches = true;
          for (let i = 0; i < zoom.length; i++) {
            if (zoom[i] !== parts[i]) { matches = false; break; }
          }
          if (!matches) continue;
          parts.splice(0, zoom.length);
          if (parts.length === 0) continue;
        }

        let current = root;
        for (const part of parts) {
          let child = current.children.get(part);
          if (!child) {
            child = { value: 0, children: new Map() };
            current.children.set(part, child);
          }
          child.value += d.value;
          current = child;
        }
      }

      const result: FlameNode[] = [];
      const maxValue = root.value || 1;

      const layout = (
        node: FlameTreeNode,
        depth: number,
        startX: number,
        totalWidth: number,
        parentName: string,
      ) => {
        let x = startX;
        for (const [name, child] of node.children) {
          const value = child.value;
          const width = (value / maxValue) * totalWidth;
          if (width >= 0.0005) {
            result.push({ name: parentName ? `${parentName};${name}` : name, value, x, width, depth });
            if (child.children.size > 0) {
              layout(child, depth + 1, x, width, parentName ? `${parentName};${name}` : name);
            }
          }
          x += width;
        }
      };

      layout(root, 0, 0, 1, "");
      return result;
    },
    []
  );

  useEffect(() => {
    setNodes(buildNodes(data, zoomPath));
  }, [data, zoomPath, buildNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0 || containerWidth === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = containerWidth;
    const maxDepth = Math.max(...nodes.map((n) => n.depth)) + 1;
    const canvasHeight = maxDepth * (ROW_HEIGHT + PADDING) + PADDING;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Theme-aware palette: read from CSS variables each redraw.
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue("--color-accent").trim() || "#3b82f6";
    const accentHover = styles.getPropertyValue("--color-accent-hover").trim() || accent;
    const textPrimary = styles.getPropertyValue("--color-text-primary").trim() || "#fff";
    const hoverColor = styles.getPropertyValue("--color-warning").trim() || "#f59e0b";

    // Build a depth-cycling palette by interpolating between accent and accent-hover.
    const colors = [
      accent,
      accentHover,
      mixHex(accent, "#ffffff", 0.15),
      mixHex(accent, "#ffffff", 0.30),
      mixHex(accent, "#ffffff", 0.45),
      mixHex(accentHover, "#ffffff", 0.15),
      mixHex(accentHover, "#ffffff", 0.30),
      mixHex(accentHover, "#ffffff", 0.45),
    ];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const x = node.x * canvasWidth + PADDING;
      const w = node.width * canvasWidth - PADDING * 2;
      const y = node.depth * (ROW_HEIGHT + PADDING) + PADDING;

      if (w < 1) continue;

      const colorIdx = node.depth % colors.length;
      ctx.fillStyle = i === hoveredIdx ? hoverColor : colors[colorIdx];
      ctx.fillRect(x, y, w, ROW_HEIGHT);

      if (w > 30) {
        ctx.fillStyle = textPrimary;
        ctx.font = "11px ui-monospace, SFMono-Regular, monospace";
        const maxTextWidth = w - 8;
        let label = node.name.split(";").pop() || node.name;
        if (ctx.measureText(label).width > maxTextWidth) {
          while (label.length > 0 && ctx.measureText(label + "...").width > maxTextWidth) {
            label = label.slice(0, -1);
          }
          label += "...";
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, y, w - 4, ROW_HEIGHT);
        ctx.clip();
        ctx.fillText(label, x + 4, y + 14);
        ctx.restore();
      }
    }
  }, [nodes, hoveredIdx, theme, containerWidth]);

  const locateNode = useCallback(
    (clientX: number, clientY: number): { idx: number; rect: DOMRect } | null => {
      const canvas = canvasRef.current;
      if (!canvas || nodes.length === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const canvasWidth = rect.width;
      const depth = Math.floor((y - PADDING) / (ROW_HEIGHT + PADDING));
      const normalX = x / canvasWidth;

      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].depth === depth && normalX >= nodes[i].x && normalX <= nodes[i].x + nodes[i].width) {
          return { idx: i, rect };
        }
      }
      return null;
    },
    [nodes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const result = locateNode(e.clientX, e.clientY);
      if (!result) { setHoveredIdx(-1); setTooltip(null); return; }
      const { idx, rect } = result;
      setHoveredIdx(idx);
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        name: nodes[idx].name,
        value: nodes[idx].value,
      });
    },
    [locateNode, nodes]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const result = locateNode(e.clientX, e.clientY);
      if (!result) return;
      const clicked = nodes[result.idx];
      // Zoom in: extend the zoom path with the clicked node's full name.
      setZoomPath(clicked.name.split(";"));
    },
    [locateNode, nodes]
  );

  if (nodes.length === 0) {
    const allEmptyNames = data.length > 0 && data.every((d) => !d.name || !d.name.trim());
    return (
      <div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
        {allEmptyNames
          ? <>Trace data exists but symbol names are empty. Enable <code className="rounded bg-[var(--surface-base)] px-1">allow_introspection_functions</code> in ClickHouse for proper stack trace resolution.</>
          : "No flame graph data available for this query. This can happen if the query was too fast to sample, or if trace_log is not enabled in ClickHouse settings."}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {zoomPath.length > 0 && (
        <button
          onClick={() => setZoomPath([])}
          className="absolute right-0 top-0 z-10 rounded border border-[var(--color-border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Reset Zoom ({zoomPath[zoomPath.length - 1]})
        </button>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Flame graph of query profile"
        className="w-full cursor-pointer rounded"
        style={{ height: 0 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setHoveredIdx(-1); setTooltip(null); }}
        onClick={handleClick}
      />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--surface-card)] px-3 py-2 text-xs shadow-[var(--shadow-md)]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <p className="truncate font-mono text-[var(--color-text-primary)]">{tooltip.name}</p>
          <p className="text-[var(--color-text-secondary)]">Samples: {tooltip.value}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Linear interpolation between two hex colors. t = 0 → a, t = 1 → b.
 * Used to generate palette depth variation without hard-coding values.
 */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const trimmed = hex.trim().replace(/^#/, "");
  if (trimmed.length !== 6) return null;
  const r = parseInt(trimmed.slice(0, 2), 16);
  const g = parseInt(trimmed.slice(2, 4), 16);
  const b = parseInt(trimmed.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b];
}
