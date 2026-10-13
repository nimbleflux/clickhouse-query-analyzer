import type { Viz } from "@viz-js/viz";

export interface RenderedGraphvizSVG {
  svg: SVGSVGElement;
  width: number;
  height: number;
}

/**
 * Render DOT to an SVG element with a usable viewBox across browsers.
 *
 * viz-js's own renderSVGElement parses via `DOMParser.parseFromString(str,
 * "image/svg+xml")`, which in some WebViews returns a document element
 * without the SVG IDL bindings (`.viewBox` undefined). Parsing through a
 * `<template>` (HTML parser, SVG-aware) yields a proper SVGSVGElement
 * everywhere, and dimensions are read from the viewBox attribute rather
 * than IDL properties.
 */
export async function renderGraphvizSVG(viz: Viz, dot: string): Promise<RenderedGraphvizSVG> {
  const result = viz.render(dot, { format: "svg" });
  const svgString = result.output ?? "";
  if (!svgString) {
    throw new Error("Graphviz produced no output" + (result.status === "failure" ? " (render failed)" : ""));
  }

  const template = document.createElement("template");
  template.innerHTML = svgString;
  const svg = template.content.firstElementChild as SVGSVGElement | null;
  if (!svg || svg.tagName.toLowerCase() !== "svg") {
    throw new Error("Graphviz did not produce an SVG document");
  }

  // viewBox = "min-x min-y width height".
  const parts = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const width = parts.length === 4 && parts[2] > 0 ? parts[2] : 0;
  const height = parts.length === 4 && parts[3] > 0 ? parts[3] : 0;
  if (!width || !height) {
    throw new Error("Graphviz SVG has no usable dimensions");
  }
  return { svg, width, height };
}
