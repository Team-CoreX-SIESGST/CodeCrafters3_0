"use client";
import { useEffect, useRef } from "react";

const STATE_COLORS = {
  focus:            "0,232,122",
  focused:          "0,232,122",
  recovery:         "34,197,94",
  fatigue:          "245,158,11",
  confusion:        "239,68,68",
  confused:         "239,68,68",
  residue:          "234,179,8",
  attention_residue:"234,179,8",
  user:             "106,169,255",
  session:          "52,178,123",
  app:              "139,92,246",
  application:      "139,92,246",
  window:           "251,191,36",
  artifact:         "34,211,238",
  snapshot:         "148,163,184",
  classifier_state: "251,113,133",
  cursor_state:     "167,139,250",
  expression:       "251,191,36",
  default:          "148,163,184",
};

function getColor(node) {
  const t = (node.type || "").toLowerCase();
  const l = (node.label || "").toLowerCase();
  return (
    STATE_COLORS[l] ||
    STATE_COLORS[t] ||
    STATE_COLORS.default
  );
}

export default function AnalyticsNodeGraph({ nodes = [], links = [], height = 500 }) {
  const cvs = useRef(null);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas || !nodes.length) return;

    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // ── build the scene from DB nodes ──────────────────────────
    const buildScene = () => {
      const r = Math.min(W, H) * 0.38;
      const dbNodes = nodes.slice(0, 18); // max 18 nodes to keep it clean
      const count = dbNodes.length;
      const sceneNodes = [];

      // Central "core" node (most connected or first node)
      const coreNode = [...dbNodes].sort((a, b) => (b.degree || 0) - (a.degree || 0))[0];
      sceneNodes.push({
        id: coreNode?.id || "CORE",
        label: coreNode ? (coreNode.label || coreNode.id).slice(0, 14) : "Core",
        color: getColor(coreNode || { type: "focus" }),
        state: "core",
        anchor: true,
        isCore: true,
        r: 18,
        orbitRadius: 0,
        orbitAngle: 0,
        orbitSpeed: 0,
        stationary: true,
        ph: 0,
        oz: r * 0.25,
        ox: 0,
        oy: 0,
        trail: [],
        trailLength: 0,
        intensity: coreNode?.degree || 100,
      });

      // Remaining nodes orbit around the core
      const rest = dbNodes.filter((n) => n.id !== coreNode?.id).slice(0, 9);
      const radii = [0.45, 0.62, 0.78, 0.9];
      rest.forEach((n, i) => {
        const ring = i % radii.length;
        const orbitRadius = radii[ring];
        const anglesOnRing = rest.filter((_, j) => j % radii.length === ring).length;
        const posOnRing = rest.slice(0, i).filter((_, j) => (i - 1 - j) % radii.length === ring).length;
        const startAngle = (posOnRing / Math.max(1, anglesOnRing)) * Math.PI * 2;
        const speed = 0.0004 / (orbitRadius * 0.8);

        sceneNodes.push({
          id: n.id,
          label: (n.label || n.id).slice(0, 14),
          color: getColor(n),
          state: (n.type || "default").toLowerCase(),
          anchor: true,
          isCore: false,
          r: 12,
          orbitRadius,
          orbitAngle: startAngle,
          orbitSpeed: speed,
          stationary: false,
          ph: Math.random() * Math.PI * 2,
          oz: r * 0.25 + (Math.random() - 0.5) * r * 0.15,
          ox: 0,
          oy: 0,
          trail: [],
          trailLength: 20,
          intensity: n.degree || 50,
        });
      });

      // Ambient signal particles
      for (let i = 0; i < 24; i++) {
        const ring = i % 4;
        const orbitRadius = 0.18 + ring * 0.12;
        const startAngle = (i / 6) * Math.PI * 2 + ring * 0.35;
        const speed = 0.0012 / (orbitRadius * orbitRadius);
        sceneNodes.push({
          anchor: false,
          isCore: false,
          r: 2.5,
          orbitRadius,
          orbitAngle: startAngle,
          orbitSpeed: speed,
          stationary: false,
          ph: Math.random() * Math.PI * 2,
          oz: r * 0.25 + (Math.random() - 0.5) * r * 0.18,
          ox: 0,
          oy: 0,
          trail: [],
          trailLength: 12,
        });
      }

      return sceneNodes;
    };

    let sceneNodes = buildScene();

    // ── utility: project 3D → 2D ────────────────────────────────
    const TILT = 0.18;
    const rx = (x, y, z, a) => ({
      x,
      y: y * Math.cos(a) - z * Math.sin(a),
      z: y * Math.sin(a) + z * Math.cos(a),
    });
    const prj = (x, y, z) => {
      const R = Math.min(W, H) * 0.38;
      const s = 440 / (440 + z + R * 0.55);
      return { sx: W / 2 + x * s, sy: H / 2 + y * s, scale: s, z };
    };

    // ── orbital rings ────────────────────────────────────────────
    const drawRings = () => {
      const r = Math.min(W, H) * 0.38;
      const cx = W / 2, cy = H / 2;
      [0.22, 0.38, 0.5, 0.65, 0.78, 0.9].forEach((mult, i) => {
        const rr = r * mult * (1 + Math.sin(frame * 0.0008 + i * 0.4) * 0.012);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rr, rr * 0.68, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(52,178,123,${0.055 + i * 0.012})`;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([5, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    };

    // ── trails ────────────────────────────────────────────────────
    const drawTrails = (pr) => {
      pr.forEach((n) => {
        if (!n.trail || n.trail.length < 2) return;
        const col = n.color || "0,232,122";
        for (let i = 1; i < n.trail.length; i++) {
          const prev = n.trail[i - 1];
          const curr = n.trail[i];
          const alpha = (i / n.trail.length) * (n.anchor ? 0.25 : 0.12);
          ctx.beginPath();
          ctx.moveTo(prev.sx, prev.sy);
          ctx.lineTo(curr.sx, curr.sy);
          ctx.strokeStyle = `rgba(${col},${alpha})`;
          ctx.lineWidth = n.anchor ? 1.2 : 0.5;
          ctx.stroke();
        }
      });
    };

    // ── draw labels ───────────────────────────────────────────────
    const drawLabels = (pr) => {
      pr.forEach((n) => {
        if (!n.anchor || !n.label) return;
        const col = n.color || "0,232,122";
        if (n.isCore) {
          ctx.font = "700 10px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = `rgba(${col},0.85)`;
          ctx.fillText(n.label.toUpperCase(), n.sx, n.sy + 38);
          return;
        }
        const angle = Math.atan2(n.sy - H / 2, n.sx - W / 2);
        const dist = 42;
        const lx = n.sx + Math.cos(angle) * dist;
        const ly = n.sy + Math.sin(angle) * dist;
        ctx.beginPath();
        ctx.moveTo(n.sx, n.sy);
        ctx.lineTo(lx, ly);
        ctx.strokeStyle = `rgba(${col},0.28)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.font = "600 9px 'IBM Plex Mono', monospace";
        const tw = ctx.measureText(n.label).width;
        ctx.fillStyle = `rgba(${col},0.1)`;
        ctx.fillRect(lx - tw / 2 - 5, ly - 7, tw + 10, 14);
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${col},0.9)`;
        ctx.fillText(n.label, lx, ly + 3);
        if (n.intensity) {
          ctx.font = "500 7px 'IBM Plex Mono', monospace";
          ctx.fillStyle = `rgba(${col},0.55)`;
          ctx.fillText(`${n.intensity}°`, lx, ly + 12);
        }
      });
    };

    // ── draw core energy beams ────────────────────────────────────
    const drawBeams = (pr) => {
      const core = pr[0];
      if (!core) return;
      pr.slice(1).forEach((n, i) => {
        if (!n.anchor) return;
        const pulse = Math.sin(frame * 0.02 + i * 0.8) * 0.5 + 0.5;
        const grad = ctx.createLinearGradient(core.sx, core.sy, n.sx, n.sy);
        const col = n.color || "0,232,122";
        grad.addColorStop(0, `rgba(${col},${0.28 + pulse * 0.12})`);
        grad.addColorStop(1, `rgba(${col},0.06)`);
        ctx.beginPath();
        ctx.moveTo(core.sx, core.sy);
        ctx.lineTo(n.sx, n.sy);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5 + pulse * 0.6;
        ctx.stroke();
      });
    };

    // ── HUD overlay ───────────────────────────────────────────────
    const drawHUD = () => {
      const pad = 10;
      ctx.strokeStyle = "rgba(0,232,122,.2)";
      ctx.lineWidth = 1;
      [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * 14, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * 14);
        ctx.stroke();
      });
      ctx.font = "500 7.5px 'IBM Plex Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,232,122,.38)";
      ctx.fillText("NEUROTRACE // DB CONTEXT", pad + 3, pad + 18);
      ctx.fillStyle = "rgba(0,232,122,.2)";
      ctx.fillText(`NODES ${nodes.length}  LINKS ${links.length}`, pad + 3, pad + 28);
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,232,122,.14)";
      ctx.font = "400 7px 'IBM Plex Mono', monospace";
      ctx.fillText("PASSIVE SIGNALS ACTIVE · DB ANALYTICS", W / 2, H - pad - 2);
    };

    let frame = 0;
    let raf;
    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);

      drawRings();

      const r = Math.min(W, H) * 0.38;
      const pr = sceneNodes.map((n) => {
        let ox, oy, oz;
        if (n.stationary) {
          ox = n.ox; oy = n.oy; oz = n.oz;
        } else {
          n.orbitAngle += n.orbitSpeed;
          if (n.orbitAngle > Math.PI * 2) n.orbitAngle -= Math.PI * 2;
          const rr = r * n.orbitRadius;
          ox = rr * Math.cos(n.orbitAngle);
          oy = rr * Math.sin(n.orbitAngle) * 0.68;
          oz = n.oz;
        }
        const p = rx(ox, oy, oz, TILT);
        const projected = { ...n, ...prj(p.x, p.y, p.z) };
        if (!n.stationary && (n.anchor || frame % 2 === 0)) {
          n.trail.push({ sx: projected.sx, sy: projected.sy });
          if (n.trail.length > n.trailLength) n.trail.shift();
        }
        return projected;
      });

      drawTrails(pr);
      drawBeams(pr);

      // Draw nodes painter's algo
      [...pr].sort((a, b) => a.z - b.z).forEach((n) => {
        const pulse = Math.sin(frame * 0.022 + n.ph);
        if (n.anchor) {
          const col = n.color || "0,232,122";
          let sz = n.r * Math.max(0.75, n.scale) * (n.isCore ? 2.4 : 1.85);
          // Glow halo
          const grad = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, sz + (n.isCore ? 16 : 12));
          grad.addColorStop(0, `rgba(${col},${n.isCore ? 0.18 : 0.13})`);
          grad.addColorStop(0.7, `rgba(${col},0.05)`);
          grad.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, sz + (n.isCore ? 16 : 12), 0, Math.PI * 2);
          ctx.fill();
          // Pulse ring
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, sz + 13 + pulse * 5, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${col},${0.16 + pulse * 0.07})`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          if (n.isCore) {
            // Extra aura rings for core
            for (let i = 3; i >= 1; i--) {
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz + 20 + i * 9 + pulse * 6, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(${col},${0.08 / i + pulse * 0.02})`;
              ctx.lineWidth = 2 - i * 0.35;
              ctx.stroke();
            }
          }
          // Main sphere
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, sz, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col},0.24)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${col},0.95)`;
          ctx.lineWidth = n.isCore ? 2.8 : 2.2;
          ctx.stroke();
          // Inner core glow
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, sz * 0.52, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col},${0.6 + pulse * 0.18})`;
          ctx.fill();
          if (n.isCore) {
            // Center bright dot
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz * 0.2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${0.75 + pulse * 0.2})`;
            ctx.fill();
          } else {
            // Node ID code
            ctx.font = "700 8px 'IBM Plex Mono',monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = "rgba(255,255,255,.9)";
            const nodeId = (n.state || "").slice(0, 3).toUpperCase() || "N";
            ctx.fillText(nodeId, n.sx, n.sy + 2.5);
          }
        } else {
          // Signal particles
          const sz = n.r * Math.max(0.6, n.scale);
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, sz + 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,232,122,${0.035 + n.scale * 0.025})`;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(n.sx, n.sy, sz, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0,232,122,${0.07 + n.scale * 0.05})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(0,232,122,${0.12 + pulse * 0.05})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      });

      drawLabels(pr);
      drawHUD();
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, [nodes, links]);

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-emerald-400/15 bg-[#02080e]" style={{ height }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(52,178,123,0.15),transparent_35%),radial-gradient(circle_at_center,rgba(106,169,255,0.1),transparent_55%)]" />
      <div className="absolute left-4 top-4 z-10 rounded-full border border-white/10 bg-black/25 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.28em] text-slate-300">
        cognitive graph · db context
      </div>
      <canvas ref={cvs} style={{ width: "100%", height: "100%", display: "block", position: "relative", zIndex: 1 }} />
    </div>
  );
}
