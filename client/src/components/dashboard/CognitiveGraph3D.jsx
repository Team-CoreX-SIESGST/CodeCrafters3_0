"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

const DEFAULT_HEIGHT = 560;

const TYPE_COLORS = {
  user: "#6aa9ff",
  session: "#34b27b",
  app: "#8b5cf6",
  application: "#8b5cf6",
  window: "#f59e0b",
  artifact: "#22d3ee",
  state: "#f87171",
  classifier_state: "#fb7185",
  cursor_state: "#a78bfa",
  expression: "#fbbf24",
  snapshot: "#94a3b8",
  default: "#94a3b8",
};

const SOURCE_STROKES = {
  db: "#6aa9ff",
  live: "#34b27b",
  both: "#22d3ee",
};

const readTheme = () => {
  if (typeof window === "undefined") {
    return {
      foreground: "#f8f9fa",
      border: "#223037",
      muted: "#1a2328",
      mutedFg: "#b9c2c9",
      primary: "#34b27b",
    };
  }

  const styles = getComputedStyle(document.documentElement);
  const getValue = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    foreground: getValue("--foreground", "#f8f9fa"),
    border: getValue("--border", "#223037"),
    muted: getValue("--muted", "#1a2328"),
    mutedFg: getValue("--muted-foreground", "#b9c2c9"),
    primary: getValue("--primary", "#34b27b"),
  };
};

const truncate = (value, length = 20) =>
  value && value.length > length ? `${value.slice(0, Math.max(1, length - 3))}...` : value;

const depthForNode = (node, index) => {
  const typeOffset = {
    user: 70,
    session: 52,
    app: 30,
    application: 30,
    window: 14,
    artifact: 42,
    state: 60,
    classifier_state: 54,
    cursor_state: 18,
    expression: 24,
    snapshot: -16,
    default: 0,
  };

  const degreeBoost = Math.min((node.degree || 0) * 3, 28);
  return (typeOffset[node.type] ?? typeOffset.default) + degreeBoost + ((index % 9) - 4) * 6;
};

const linkKey = (link) => `${link.source}->${link.target}:${link.label}`;

export default function CognitiveGraph3D({
  nodes = [],
  links = [],
  height = DEFAULT_HEIGHT,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const rafRef = useRef(0);
  const zoomTransformRef = useRef(d3.zoomIdentity);
  const hoveredNodeIdRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height });
  const theme = useMemo(() => readTheme(), []);

  useEffect(() => {
    if (!wrapRef.current) return undefined;

    const measure = () => {
      setSize({
        width: wrapRef.current?.clientWidth || 0,
        height,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapRef.current);

    return () => observer.disconnect();
  }, [height]);

  useEffect(() => {
    if (!svgRef.current || !size.width || !nodes.length) return undefined;

    const width = size.width;
    const innerHeight = size.height;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${innerHeight}`);

    const defs = svg.append("defs");
    const glow = defs.append("filter").attr("id", "graph-node-glow");
    glow.append("feGaussianBlur").attr("stdDeviation", 4).attr("result", "blur");
    const merge = glow.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    const background = svg.append("g");
    for (let index = 0; index < 7; index += 1) {
      background
        .append("ellipse")
        .attr("cx", width / 2)
        .attr("cy", innerHeight / 2)
        .attr("rx", 80 + index * 46)
        .attr("ry", 38 + index * 24)
        .attr("fill", "none")
        .attr("stroke", `rgba(52,178,123,${0.08 + index * 0.015})`)
        .attr("stroke-dasharray", "5 7");
    }

    for (let x = 0; x < width; x += 44) {
      background
        .append("line")
        .attr("x1", x)
        .attr("y1", 0)
        .attr("x2", x)
        .attr("y2", innerHeight)
        .attr("stroke", theme.muted)
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 0.6);
    }

    for (let y = 0; y < innerHeight; y += 44) {
      background
        .append("line")
        .attr("x1", 0)
        .attr("y1", y)
        .attr("x2", width)
        .attr("y2", y)
        .attr("stroke", theme.muted)
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 0.6);
    }

    const scene = svg.append("g");
    const linkLayer = scene.append("g");
    const nodeLayer = scene.append("g");

    const graphNodes = nodes.map((node, index) => ({
      ...node,
      x: ((index % 10) - 5) * 48,
      y: (Math.floor(index / 10) - Math.ceil(nodes.length / 20)) * 48,
      z: depthForNode(node, index),
      baseZ: depthForNode(node, index),
      phase: (index % 13) * 0.47,
    }));

    const nodeById = new Map(graphNodes.map((node) => [node.id, node]));
    const graphLinks = links
      .filter((link) => nodeById.has(link.source) && nodeById.has(link.target))
      .map((link) => ({
        ...link,
        source: nodeById.get(link.source),
        target: nodeById.get(link.target),
      }));

    const topNodeIds = new Set(
      [...graphNodes]
        .sort((left, right) => (right.degree || 0) - (left.degree || 0))
        .slice(0, 22)
        .map((node) => node.id)
    );

    const projectNode = (node, timestamp = 0) => {
      const animatedZ = node.baseZ + Math.sin(timestamp * 0.0012 + node.phase) * 11;
      node.z = animatedZ;

      const isoX = node.x + animatedZ * 0.42;
      const isoY = node.y - animatedZ * 0.26;
      const transform = zoomTransformRef.current;
      const screenX = isoX * transform.k + transform.x + width / 2;
      const screenY = isoY * transform.k + transform.y + innerHeight / 2;
      const scale = Math.max(0.75, 1 + animatedZ / 260) * transform.k;
      return { x: screenX, y: screenY, z: animatedZ, scale };
    };

    const screenToWorld = (screenX, screenY, z) => {
      const transform = zoomTransformRef.current;
      const isoX = (screenX - transform.x - width / 2) / transform.k;
      const isoY = (screenY - transform.y - innerHeight / 2) / transform.k;
      return {
        x: isoX - z * 0.42,
        y: isoY + z * 0.26,
      };
    };

    const render = (timestamp = performance.now()) => {
      graphNodes.forEach((node) => {
        node._projected = projectNode(node, timestamp);
      });

      linkLayer
        .selectAll("line.graph-link")
        .data(graphLinks, (link) =>
          linkKey({ source: link.source.id, target: link.target.id, label: link.label })
        )
        .join("line")
        .attr("class", "graph-link")
        .attr("x1", (link) => link.source._projected.x)
        .attr("y1", (link) => link.source._projected.y)
        .attr("x2", (link) => link.target._projected.x)
        .attr("y2", (link) => link.target._projected.y)
        .attr("stroke", (link) => SOURCE_STROKES[link.sourceKind] || theme.border)
        .attr("stroke-width", (link) => (link.sourceKind === "both" ? 1.7 : 1.15))
        .attr("stroke-opacity", (link) => (link.sourceKind === "db" ? 0.3 : 0.55))
        .attr("stroke-dasharray", (link) =>
          link.sourceKind === "db" ? "4 6" : link.sourceKind === "both" ? "0" : "2 4"
        );

      const nodeSelection = nodeLayer
        .selectAll("g.graph-node")
        .data(graphNodes, (node) => node.id)
        .join((enter) => {
          const group = enter.append("g").attr("class", "graph-node").style("cursor", "grab");
          group.append("circle").attr("class", "halo");
          group.append("circle").attr("class", "core").attr("filter", "url(#graph-node-glow)");
          group.append("circle").attr("class", "rim").attr("fill", "none");
          group.append("text").attr("class", "label");
          group.append("text").attr("class", "meta");
          return group;
        });

      nodeSelection
        .sort((left, right) => (left._projected?.z || 0) - (right._projected?.z || 0))
        .attr("transform", (node) => `translate(${node._projected.x},${node._projected.y})`);

      nodeSelection
        .select("circle.halo")
        .attr("r", (node) => 14 + Math.max(0, (node.degree || 0) * 0.6))
        .attr("fill", (node) => `${(TYPE_COLORS[node.type] || TYPE_COLORS.default)}20`);

      nodeSelection
        .select("circle.core")
        .attr("r", (node) => 5.2 + Math.min(7, (node.degree || 0) * 0.35))
        .attr("fill", (node) => TYPE_COLORS[node.type] || TYPE_COLORS.default)
        .attr("opacity", (node) => Math.max(0.78, Math.min(1, node._projected.scale)));

      nodeSelection
        .select("circle.rim")
        .attr("r", (node) => 10 + Math.max(1, (node.degree || 0) * 0.38))
        .attr("stroke", (node) => SOURCE_STROKES[node.source] || theme.primary)
        .attr("stroke-width", (node) => (node.source === "both" ? 1.6 : 1.1))
        .attr("stroke-opacity", 0.95);

      nodeSelection
        .select("text.label")
        .attr("y", (node) => -18 - Math.max(0, (node.degree || 0) * 0.15))
        .attr("text-anchor", "middle")
        .attr("fill", theme.foreground)
        .style("font-size", "10px")
        .style("font-weight", "600")
        .style("display", (node) =>
          hoveredNodeIdRef.current === node.id || topNodeIds.has(node.id) ? "block" : "none"
        )
        .text((node) => truncate(node.label, 24));

      nodeSelection
        .select("text.meta")
        .attr("y", (node) => 25 + Math.max(0, (node.degree || 0) * 0.12))
        .attr("text-anchor", "middle")
        .attr("fill", theme.mutedFg)
        .style("font-size", "8px")
        .style("letter-spacing", "0.2em")
        .style("text-transform", "uppercase")
        .style("display", (node) =>
          hoveredNodeIdRef.current === node.id || topNodeIds.has(node.id) ? "block" : "none"
        )
        .text((node) => `${node.type} | ${node.source}`);
    };

    const simulation = d3
      .forceSimulation(graphNodes)
      .force(
        "link",
        d3
          .forceLink(graphLinks)
          .id((node) => node.id)
          .distance((link) => {
            const sourceDegree = link.source.degree || 0;
            const targetDegree = link.target.degree || 0;
            return 70 + Math.max(sourceDegree, targetDegree) * 4;
          })
          .strength(0.15)
      )
      .force("charge", d3.forceManyBody().strength(-260))
      .force("x", d3.forceX(0).strength(0.03))
      .force("y", d3.forceY(0).strength(0.03))
      .force("collision", d3.forceCollide((node) => 18 + Math.min(18, (node.degree || 0) * 0.6)))
      .alpha(0.95)
      .alphaDecay(0.03)
      .on("tick", () => render());

    const drag = d3
      .drag()
      .subject((event) => {
        const [pointerX, pointerY] = d3.pointer(event, svg.node());
        let bestNode = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const node of graphNodes) {
          const projected = node._projected || projectNode(node, performance.now());
          const distance = Math.hypot(projected.x - pointerX, projected.y - pointerY);
          if (distance < 24 && distance < bestDistance) {
            bestNode = node;
            bestDistance = distance;
          }
        }

        return bestNode;
      })
      .on("start", (event) => {
        if (!event.subject) return;
        hoveredNodeIdRef.current = event.subject.id;
        if (!event.active) simulation.alphaTarget(0.32).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        if (!event.subject) return;
        const world = screenToWorld(event.x, event.y, event.subject.z || event.subject.baseZ || 0);
        event.subject.fx = world.x;
        event.subject.fy = world.y;
        render();
      })
      .on("end", (event) => {
        if (!event.subject) return;
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
      });

    const bindNodeInteractions = () => {
      const currentNodeSelection = nodeLayer.selectAll("g.graph-node");
      currentNodeSelection.call(drag);
      currentNodeSelection
        .on("mouseenter", (_, node) => {
          hoveredNodeIdRef.current = node.id;
          render();
        })
        .on("mouseleave", () => {
          hoveredNodeIdRef.current = null;
          render();
        });
    };

    const zoom = d3
      .zoom()
      .scaleExtent([0.45, 2.4])
      .on("zoom", (event) => {
        zoomTransformRef.current = event.transform;
        render();
      });

    svg.call(zoom).on("dblclick.zoom", null);
    svg.call(zoom.transform, d3.zoomIdentity.translate(0, 0).scale(0.96));

    const animate = (timestamp) => {
      render(timestamp);
      rafRef.current = window.requestAnimationFrame(animate);
    };

    render();
    bindNodeInteractions();
    rafRef.current = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafRef.current);
      simulation.stop();
      svg.on(".zoom", null);
    };
  }, [height, links, nodes, size.height, size.width, theme]);

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-[1.75rem] border border-emerald-400/15 bg-[#02080e]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(52,178,123,0.18),transparent_32%),radial-gradient(circle_at_center,rgba(106,169,255,0.12),transparent_52%)]" />
      <div className="absolute left-4 top-4 z-10 rounded-full border border-white/10 bg-black/25 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-300">
        drag nodes | wheel zoom | drag canvas
      </div>
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        {["db", "live", "both"].map((key) => (
          <span
            key={key}
            className="rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-200"
            style={{
              borderColor: `${SOURCE_STROKES[key]}55`,
              background: `${SOURCE_STROKES[key]}18`,
            }}
          >
            {key}
          </span>
        ))}
      </div>
      <svg ref={svgRef} className="relative z-[1] block w-full" style={{ height }} />
    </div>
  );
}
