"use client";
import { useEffect, useRef, useState } from "react";

/* ── colour palette ─────────────────────────────────────────────── */
const TYPE_COLORS = {
  focus:             [0, 232, 122],
  focused:           [0, 232, 122],
  recovery:          [34, 197, 94],
  fatigue:           [245, 158, 11],
  confusion:         [239, 68, 68],
  confused:          [239, 68, 68],
  residue:           [234, 179, 8],
  attention_residue: [234, 179, 8],
  user:              [106, 169, 255],
  session:           [52, 178, 123],
  app:               [139, 92, 246],
  application:       [139, 92, 246],
  window:            [251, 191, 36],
  artifact:          [34, 211, 238],
  snapshot:          [148, 163, 184],
  classifier_state:  [251, 113, 133],
  cursor_state:      [167, 139, 250],
  expression:        [251, 191, 36],
  default:           [148, 163, 184],
};

function getColor(node) {
  const t = (node?.type  || "").toLowerCase();
  const l = (node?.label || "").toLowerCase();
  return TYPE_COLORS[l] || TYPE_COLORS[t] || TYPE_COLORS.default;
}

const rgb  = (c, a = 1)       => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const lerp = (a, b, t)        => a + (b - a) * t;

/* ── 3-D math helpers ────────────────────────────────────────────── */
const rotX = (x, y, z, a) => ({ x, y: y * Math.cos(a) - z * Math.sin(a), z: y * Math.sin(a) + z * Math.cos(a) });
const rotY = (x, y, z, a) => ({ x: x * Math.cos(a) + z * Math.sin(a), y, z: -x * Math.sin(a) + z * Math.cos(a) });

/* perspective projection */
const project = (x, y, z, W, H, FOV = 700, camZ = -380) => {
  const dz = z - camZ;
  const scale = FOV / Math.max(1, FOV + dz);
  return { sx: W / 2 + x * scale, sy: H / 2 + y * scale, scale: Math.max(0.3, scale), z };
};

export default function AnalyticsNodeGraph({ nodes = [], links = [], height = 500 }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);

  /* ── rebuild scene whenever data changes ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    /* ── initial placement – sphere shell layout ─── */
    const dbNodes = nodes.slice(0, 22);

    const sceneNodes = dbNodes.map((n, i) => {
      /* Fibonacci sphere distribution */
      const golden = Math.PI * (3 - Math.sqrt(5));
      const yy = 1 - (i / Math.max(1, dbNodes.length - 1)) * 2;
      const r3 = Math.sqrt(1 - yy * yy);
      const theta = golden * i;
      const RADIUS = 420;
      return {
        id:     n.id,
        label:  (n.label || n.id || "node").slice(0, 16),
        type:   (n.type || "default").toLowerCase(),
        color:  getColor(n),
        degree: n.degree || 0,
        sizeMult: ["app","application","cursor_state","window","expression","residue","attention_residue"].includes((n.type || "").toLowerCase()) ? 2.8 : 1.0,
        // 3-D position (mutable)
        x:  RADIUS * r3 * Math.cos(theta),
        y:  RADIUS * yy,
        z:  RADIUS * r3 * Math.sin(theta),
        // animation
        phase:    (i * 0.47) % (Math.PI * 2),
        velX: 0, velY: 0, velZ: 0,  // spring velocity
        // interaction
        dragging: false,
        pinned:   false,
        trail:    [],
      };
    });

    const nodeById = new Map(sceneNodes.map((n) => [n.id, n]));
    const sceneLinks = links
      .filter((l) => nodeById.has(l.source) && nodeById.has(l.target))
      .map((l) => ({ a: nodeById.get(l.source), b: nodeById.get(l.target), label: l.label }));

    /* ── interaction state ─── */
    let rotAngleX = -0.28;
    let rotAngleY = 0.38;
    let isDraggingScene = false;
    let lastMX = 0, lastMY = 0;
    let draggedNode = null;
    let dragDepth = 0;          // z-plane of dragged node in rotated space
    let frame = 0;
    let W = 0, H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    /* ── canvas resize ─── */
    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    /* ── project and rotate all nodes ─── */
    const projectAll = () =>
      sceneNodes.map((n) => {
        // rotate scene
        let p = rotY(n.x, n.y, n.z, rotAngleY);
        p     = rotX(p.x, p.y, p.z, rotAngleX);
        const proj = project(p.x, p.y, p.z, W, H);
        n._proj = { ...proj };
        return n;
      });

    /* ── hit test: return node under cursor ─── */
    const hitTest = (mx, my) => {
      let best = null, bd = Infinity;
      for (const n of sceneNodes) {
        if (!n._proj) continue;
        const radius = 14 + n.degree * 0.5;
        const d = Math.hypot(n._proj.sx - mx, n._proj.sy - my);
        if (d < radius + 8 && d < bd) { best = n; bd = d; }
      }
      return best;
    };

    /* ── mouse / touch helpers ─── */
    const getXY = (e) => {
      const rect = canvas.getBoundingClientRect();
      const src  = e.touches ? e.touches[0] : e;
      return [src.clientX - rect.left, src.clientY - rect.top];
    };

    const onDown = (e) => {
      const [mx, my] = getXY(e);
      const hit = hitTest(mx, my);
      if (hit) {
        draggedNode  = hit;
        hit.dragging = true;
        hit.pinned   = true;
        // record the depth plane of this node in rotated space
        let p = rotY(hit.x, hit.y, hit.z, rotAngleY);
        p     = rotX(p.x, p.y, p.z, rotAngleX);
        dragDepth = p.z;
      } else {
        isDraggingScene = true;
      }
      lastMX = mx; lastMY = my;
      e.preventDefault();
    };

    const onMove = (e) => {
      const [mx, my] = getXY(e);
      const dx = mx - lastMX, dy = my - lastMY;
      if (draggedNode) {
        /* un-project from screen to 3-D */
        const FOV = 700, camZ = -380;
        const dz = dragDepth - camZ;
        const scale = FOV / Math.max(1, FOV + dz);
        const rx3 = (mx - W / 2) / scale;
        const ry3 = (my - H / 2) / scale;
        const rz3 = dragDepth;
        // undo scene rotation
        let p = rotX(rx3, ry3, rz3, -rotAngleX);
        p     = rotY(p.x, p.y, p.z, -rotAngleY);
        draggedNode.x = p.x;
        draggedNode.y = p.y;
        draggedNode.z = p.z;
      } else if (isDraggingScene) {
        rotAngleY += dx * 0.006;
        rotAngleX += dy * 0.006;
        rotAngleX = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, rotAngleX));
      }
      lastMX = mx; lastMY = my;
      e.preventDefault();
    };

    const onUp = () => {
      if (draggedNode) { draggedNode.dragging = false; draggedNode = null; }
      isDraggingScene = false;
    };

    canvas.addEventListener("mousedown",  onDown,  { passive: false });
    canvas.addEventListener("mousemove",  onMove,  { passive: false });
    canvas.addEventListener("mouseup",    onUp);
    canvas.addEventListener("mouseleave", onUp);
    canvas.addEventListener("touchstart", onDown,  { passive: false });
    canvas.addEventListener("touchmove",  onMove,  { passive: false });
    canvas.addEventListener("touchend",   onUp);

    /* ── auto rotate when idle ─── */
    const AUTO_SPEED = 0.0008;

    /* ── main render ─── */
    const ctx = canvas.getContext("2d");

    const drawGrid = () => {
      const steps = 7, spacing = 55;
      const pts = [];
      for (let ix = -steps; ix <= steps; ix++)
        for (let iy = -steps; iy <= steps; iy++) {
          let p = rotY(ix * spacing, 0, iy * spacing, rotAngleY);
          p = rotX(p.x, p.y, p.z, rotAngleX);
          const pr = project(p.x, p.y, p.z, W, H);
          pts.push({ ix, iy, ...pr });
        }
      ctx.strokeStyle = "rgba(52,178,123,0.07)";
      ctx.lineWidth = 0.5;
      for (const pt of pts) {
        const right = pts.find((q) => q.ix === pt.ix + 1 && q.iy === pt.iy);
        const down  = pts.find((q) => q.ix === pt.ix && q.iy === pt.iy + 1);
        if (right) { ctx.beginPath(); ctx.moveTo(pt.sx, pt.sy); ctx.lineTo(right.sx, right.sy); ctx.stroke(); }
        if (down)  { ctx.beginPath(); ctx.moveTo(pt.sx, pt.sy); ctx.lineTo(down.sx,  down.sy);  ctx.stroke(); }
      }
    };

    const drawLinks = (projected) => {
      for (const lk of sceneLinks) {
        const a = lk.a._proj, b = lk.b._proj;
        if (!a || !b) continue;
        const avgZ    = (a.z + b.z) / 2;
        const alpha   = Math.max(0.06, Math.min(0.45, 0.25 - avgZ / 1800));
        const grad    = ctx.createLinearGradient(a.sx, a.sy, b.sx, b.sy);
        const ca = lk.a.color, cb = lk.b.color;
        grad.addColorStop(0, rgb(ca, alpha * 1.4));
        grad.addColorStop(1, rgb(cb, alpha));
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    };

    const drawNode = (n) => {
      const { sx, sy, scale, z } = n._proj;
      const col     = n.color;
      const pulse   = Math.sin(frame * 0.022 + n.phase) * 0.5 + 0.5;
      // base radius scales with degree and depth
      const baseR   = (8 + Math.min(8, n.degree * 0.5)) * Math.max(0.55, scale) * (n.sizeMult || 1);
      const isHover = n.dragging || n.pinned;

      /* depth-based alpha — only used for subtle stroke/label fading, NOT fills */
      const depthAlpha = Math.max(0.72, 1 - Math.abs(z) / 900);

      /* outer glow halo — BRIGHT */
      const haloR  = baseR + 20 + pulse * 7;
      const haloGr = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloR);
      haloGr.addColorStop(0,   rgb(col, 0.38));
      haloGr.addColorStop(0.55, rgb(col, 0.14));
      haloGr.addColorStop(1,   rgb(col, 0));
      ctx.beginPath();
      ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
      ctx.fillStyle = haloGr;
      ctx.fill();

      /* pulsing outer ring */
      ctx.beginPath();
      ctx.arc(sx, sy, baseR + 13 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(col, 0.42 + pulse * 0.18);
      ctx.lineWidth   = 1.6;
      ctx.stroke();

      /* if dragging/hovered: extra aura rings */
      if (isHover) {
        for (let i = 3; i >= 1; i--) {
          ctx.beginPath();
          ctx.arc(sx, sy, baseR + 22 + i * 9 + pulse * 5, 0, Math.PI * 2);
          ctx.strokeStyle = rgb(col, 0.18 / i + pulse * 0.04);
          ctx.lineWidth   = 2 - i * 0.3;
          ctx.stroke();
        }
      }

      /* main sphere fill — VIVID solid look */
      ctx.beginPath();
      ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
      ctx.fillStyle   = rgb(col, 0.72);   // was 0.22 — now bright
      ctx.fill();
      ctx.strokeStyle = rgb(col, depthAlpha);
      ctx.lineWidth   = isHover ? 3.2 : 2.4;
      ctx.stroke();

      /* inner bright core — almost opaque */
      ctx.beginPath();
      ctx.arc(sx, sy, baseR * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = rgb(col, 0.95 + pulse * 0.05);  // was 0.6 — now fully lit
      ctx.fill();

      /* specular highlight */
      const specGr = ctx.createRadialGradient(sx - baseR * 0.28, sy - baseR * 0.32, 0, sx, sy, baseR);
      specGr.addColorStop(0, `rgba(255,255,255,0.45)`);
      specGr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.arc(sx, sy, baseR, 0, Math.PI * 2);
      ctx.fillStyle = specGr;
      ctx.fill();

      /* label — always show */
      const labelY = sy - baseR - 10;
      ctx.font        = `${isHover ? 700 : 600} 9px 'IBM Plex Mono', monospace`;
      ctx.textAlign   = "center";
      ctx.fillStyle   = rgb(col, depthAlpha);
      ctx.fillText(n.label.toUpperCase(), sx, labelY);

      /* type badge below */
      ctx.font        = "500 7px 'IBM Plex Mono', monospace";
      ctx.fillStyle   = `rgba(200,220,240,${0.75 * depthAlpha})`;
      ctx.fillText(n.type.toUpperCase(), sx, sy + baseR + 14);
    };

    const drawHUD = () => {
      const pad = 10;
      ctx.strokeStyle = "rgba(0,232,122,0.22)";
      ctx.lineWidth   = 1;
      for (const [x, y, sx, sy] of [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]) {
        ctx.beginPath(); ctx.moveTo(x + sx * 14, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * 14); ctx.stroke();
      }
      ctx.font      = "500 7.5px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,232,122,0.38)";
      ctx.fillText("NEUROTRACE // 3D DB CONTEXT", pad + 3, pad + 18);
      ctx.fillStyle = "rgba(0,232,122,0.2)";
      ctx.fillText(`NODES ${nodes.length}  LINKS ${links.length}`, pad + 3, pad + 28);
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(106,169,255,0.4)";
      ctx.fillText("DRAG NODE · DRAG BG TO ROTATE", W - pad - 3, pad + 18);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,232,122,0.12)";
      ctx.font      = "400 7px 'IBM Plex Mono', monospace";
      ctx.fillText("PASSIVE SIGNALS ACTIVE · DB ANALYTICS", W / 2, H - pad - 2);
    };

    let raf;
    const draw = (ts = 0) => {
      frame++;
      ctx.clearRect(0, 0, W, H);

      // soft auto rotate when nothing is dragged
      if (!isDraggingScene && !draggedNode) {
        rotAngleY += AUTO_SPEED;
      }

      // apply spring physics to release position
      for (const n of sceneNodes) {
        if (!n.pinned || n.dragging) {
          // gentle orbital drift when released
          n.x += n.velX;
          n.y += n.velY;
          n.z += n.velZ;
          n.velX *= 0.95;
          n.velY *= 0.95;
          n.velZ *= 0.95;
        }
      }

      // project all nodes
      projectAll();

      // sort by projected z for painter's algo
      const sorted = [...sceneNodes].sort((a, b) => (a._proj?.z || 0) - (b._proj?.z || 0));

      drawGrid();
      drawLinks(sorted);
      sorted.forEach(drawNode);
      drawHUD();

      raf = requestAnimationFrame(draw);
    };
    draw();

    /* ── cursor style ─── */
    canvas.style.cursor = "grab";
    canvas.addEventListener("mousedown",  () => { canvas.style.cursor = "grabbing"; });
    canvas.addEventListener("mouseup",    () => { canvas.style.cursor = "grab"; });
    canvas.addEventListener("mouseleave", () => { canvas.style.cursor = "grab"; });

    /* ── store state ref so we can signal cleanup ─── */
    stateRef.current = { cancel: () => cancelAnimationFrame(raf) };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown",  onDown);
      canvas.removeEventListener("mousemove",  onMove);
      canvas.removeEventListener("mouseup",    onUp);
      canvas.removeEventListener("mouseleave", onUp);
      canvas.removeEventListener("touchstart", onDown);
      canvas.removeEventListener("touchmove",  onMove);
      canvas.removeEventListener("touchend",   onUp);
    };
  }, [nodes, links]);

  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-[1.75rem] border border-emerald-400/15 bg-[#02080e]"
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* background radial glow */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,rgba(52,178,123,0.13),transparent_55%),radial-gradient(ellipse_at_80%_20%,rgba(106,169,255,0.09),transparent_45%)]" />

      {/* hint badge */}
      <div className="absolute left-4 top-4 z-10 rounded-full border border-white/10 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-300 pointer-events-none">
        drag node · drag bg to rotate · 3d
      </div>

      {/* fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-emerald-400/30 bg-black/40 text-emerald-300 transition hover:bg-emerald-400/20 hover:border-emerald-400/60"
      >
        {isFullscreen ? (
          /* shrink icon */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
            <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
            <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
            <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
          </svg>
        ) : (
          /* expand icon */
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M3 7V3h4"/>
            <path d="M17 3h4v4"/>
            <path d="M21 17v4h-4"/>
            <path d="M7 21H3v-4"/>
          </svg>
        )}
      </button>

      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block", position: "relative", zIndex: 1 }}
      />
    </div>
  );
}
