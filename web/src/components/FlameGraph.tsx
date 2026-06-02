import { useCallback, useRef, useEffect, useState } from "react";

interface FlameNode {
  name: string;
  value: number;
  x: number;
  width: number;
  depth: number;
}

export function FlameGraph({ data }: { data: { name: string; value: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; value: number } | null>(null);
  const [nodes, setNodes] = useState<FlameNode[]>([]);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const [zoomRoot, setZoomRoot] = useState<string | null>(null);

  const ROW_HEIGHT = 20;
  const PADDING = 1;

  const buildNodes = useCallback((rawData: { name: string; value: number }[]): FlameNode[] => {
    if (rawData.length === 0) return [];

    const root: Map<string, { value: number; children: Map<string, { value: number; children: Map<string, unknown> }> }> = new Map();

    let maxValue = 0;
    for (const d of rawData) {
      const parts = d.name.split(";").filter(Boolean);
      if (parts.length === 0) continue;

      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!current.has(part)) {
          current.set(part, { value: 0, children: new Map() });
        }
        const node = current.get(part)!;
        node.value += d.value;
        if (node.value > maxValue) maxValue = node.value;
        current = node.children as typeof root;
      }
    }

    const result: FlameNode[] = [];

    const layout = (
      map: Map<string, { value: number; children: Map<string, unknown> }>,
      depth: number,
      startX: number,
      totalWidth: number,
    ) => {
      let x = startX;
      for (const [name, node] of map) {
        const value = node.value;
        const width = (value / maxValue) * totalWidth;
        if (width >= 0.5) {
          result.push({ name, value, x, width, depth });
          if (node.children.size > 0) {
            layout(node.children as typeof map, depth + 1, x, width);
          }
        }
        x += width;
      }
    };

    layout(root as Map<string, { value: number; children: Map<string, unknown> }>, 0, 0, 1);
    return result;
  }, []);

  useEffect(() => {
    setNodes(buildNodes(data));
  }, [data, buildNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const maxWidth = 1000;
    const rect = canvas.parentElement!.getBoundingClientRect();
    const canvasWidth = Math.min(rect.width, maxWidth);
    const maxDepth = Math.max(...nodes.map((n) => n.depth)) + 1;
    const canvasHeight = maxDepth * (ROW_HEIGHT + PADDING) + PADDING;

    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const colors = ["#3b82f6", "#2563eb", "#1d4ed8", "#60a5fa", "#93c5fd", "#8b5cf6", "#7c3aed", "#a78bfa"];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const x = node.x * canvasWidth + PADDING;
      const w = node.width * canvasWidth - PADDING * 2;
      const y = node.depth * (ROW_HEIGHT + PADDING) + PADDING;

      if (w < 1) continue;

      const colorIdx = node.depth % colors.length;
      ctx.fillStyle = i === hoveredIdx ? "#f59e0b" : colors[colorIdx];
      ctx.fillRect(x, y, w, ROW_HEIGHT);

      if (w > 30) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-text-primary").trim() || "#fff";
        ctx.font = "11px monospace";
        const maxTextWidth = w - 8;
        let label = node.name;
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
  }, [nodes, hoveredIdx]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || nodes.length === 0) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const canvasWidth = rect.width;

      const depth = Math.floor((y - PADDING) / (ROW_HEIGHT + PADDING));
      const normalX = x / canvasWidth;

      let found = -1;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].depth === depth && normalX >= nodes[i].x && normalX <= nodes[i].x + nodes[i].width) {
          found = i;
          break;
        }
      }

      setHoveredIdx(found);
      if (found >= 0) {
        setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, name: nodes[found].name, value: nodes[found].value });
      } else {
        setTooltip(null);
      }
    },
    [nodes],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || nodes.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const canvasWidth = rect.width;
      const depth = Math.floor((y - PADDING) / (ROW_HEIGHT + PADDING));
      const normalX = x / canvasWidth;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].depth === depth && normalX >= nodes[i].x && normalX <= nodes[i].x + nodes[i].width) {
          setZoomRoot(nodes[i].name);
          return;
        }
      }
    },
    [nodes],
  );

  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
        No flame graph data available for this query. This can happen if the query was too fast to sample, or if trace_log is not enabled in ClickHouse settings.
      </div>
    );
  }

  return (
    <div className="relative">
      {zoomRoot && (
        <button
          onClick={() => setZoomRoot(null)}
          className="absolute right-0 top-0 z-10 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        >
          Reset Zoom
        </button>
      )}
      <canvas ref={canvasRef} role="img" aria-label="Flame graph of query profile" className="w-full cursor-pointer rounded" onMouseMove={handleMouseMove} onMouseLeave={() => { setHoveredIdx(-1); setTooltip(null); }} onClick={handleClick} />
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <p className="max-w-xs truncate font-mono text-[var(--color-text-primary)]">{tooltip.name}</p>
          <p className="text-[var(--color-text-secondary)]">Samples: {tooltip.value}</p>
        </div>
      )}
    </div>
  );
}
