// "use client";
import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: "Passive", label: "Signal Collection" },
  { value: "6", label: "Cognitive States Tracked" },
  { value: "Real-time", label: "State Inference" },
];

// ══════════════════════════════════════════════════════════════════
//  CognitiveField — asymmetric signal lattice for NeuroTrace
// ══════════════════════════════════════════════════════════════════
const CognitiveField = () => {
  const cvs = useRef(null);

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0,
      H = 0;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    /* ── 3-D math (reused from original) ──────────────────────── */
    const ry = (x, y, z, a) => ({
      x: x * Math.cos(a) + z * Math.sin(a),
      y,
      z: -x * Math.sin(a) + z * Math.cos(a),
    });
    const rx = (x, y, z, a) => ({
      x,
      y: y * Math.cos(a) - z * Math.sin(a),
      z: y * Math.sin(a) + z * Math.cos(a),
    });
    const prj = (x, y, z) => {
      const R = Math.min(W, H) * 0.62;
      const s = 440 / (440 + z + R * 0.55);
      return { sx: W / 2 + x * s, sy: H / 2 + y * s + 12, scale: s, z };
    };
    const R = () => Math.min(W, H) * 0.62;

    /* ── build cognitive field scene ──────────────────────────── */
    const buildScene = () => {
      const r = R() || 130;
      const nds = [];

      // Central inference core - STATIONARY (no orbit)
      nds.push({
        ox: 0,
        oy: 0,
        oz: r * 0.25,
        id: "CORE",
        label: "Inference Engine",
        state: "core",
        intensity: 100,
        anchor: true,
        r: 18,
        ph: 0,
        stationary: true,
        orbitRadius: 0,
        orbitAngle: 0,
        orbitSpeed: 0,
      });

      // State anchor nodes - each orbits on its ring
      // Orbital speed inversely proportional to radius (inner = faster, like real physics)
      const stateAnchors = [
        { 
          orbitRadius: 0.82, startAngle: 0, 
          id: "FOCUS", label: "Focus State", state: "focus", intensity: 92,
          orbitSpeed: 0.00045,
        },
        { 
          orbitRadius: 0.68, startAngle: Math.PI * 0.42, 
          id: "CONFUSION", label: "Confusion", state: "confusion", intensity: 87,
          orbitSpeed: 0.00065,
        },
        { 
          orbitRadius: 0.88, startAngle: Math.PI * 1.18, 
          id: "FATIGUE", label: "Fatigue State", state: "fatigue", intensity: 71,
          orbitSpeed: 0.00040,
        },
        { 
          orbitRadius: 0.68, startAngle: Math.PI * 1.68, 
          id: "RESIDUE", label: "Attention Residue", state: "residue", intensity: 64,
          orbitSpeed: 0.00065,
        },
        { 
          orbitRadius: 0.82, startAngle: Math.PI, 
          id: "RECOVERY", label: "Recovery", state: "recovery", intensity: 78,
          orbitSpeed: 0.00045,
        },
      ];

      stateAnchors.forEach((s) => {
        nds.push({
          ...s,
          anchor: true,
          r: 14,
          ph: Math.random() * 6.28,
          stationary: false,
          orbitAngle: s.startAngle,
          ox: 0,
          oy: 0,
          oz: r * 0.25,
        });
      });

      // Signal trace particles on inner orbits - faster orbital speeds
      for (let i = 0; i < 32; i++) {
        const ringIdx = i % 4;
        const orbitRadius = 0.22 + ringIdx * 0.11;
        const startAngle = (i / 8) * Math.PI * 2 + (ringIdx * 0.4);
        const orbitSpeed = 0.0015 / (orbitRadius * orbitRadius);
        
        nds.push({
          orbitRadius,
          orbitAngle: startAngle,
          orbitSpeed,
          anchor: false,
          r: 2.8,
          ph: Math.random() * 6.28,
          id: null,
          stationary: false,
          ox: 0,
          oy: 0,
          oz: r * 0.25 + (Math.random() - 0.5) * r * 0.15,
        });
      }

      // Inference paths - connect core to states, and states in cycle
      const paths = [];
      
      // Core connections to all state anchors (radial)
      for (let i = 1; i <= 5; i++) {
        paths.push({ a: 0, b: i, type: "core", curve: 0 });
      }

      // State transition cycle (curved connections between orbiting states)
      paths.push(
        { a: 1, b: 2, type: "transition", curve: 0.15 },  // Focus → Confusion
        { a: 2, b: 3, type: "transition", curve: 0.12 }, // Confusion → Fatigue
        { a: 3, b: 5, type: "transition", curve: 0.15 },  // Fatigue → Recovery
        { a: 5, b: 1, type: "transition", curve: 0.12 }, // Recovery → Focus
        { a: 4, b: 2, type: "drift", curve: 0.2 },      // Residue → Confusion
        { a: 1, b: 4, type: "drift", curve: -0.15 },      // Focus → Residue
      );

      return { nds, paths };
    };

    let { nds: nodes, paths } = buildScene();

    // Initialize trail history for each node
    nodes.forEach((n) => {
      if (!n.stationary) {
        n.trail = []; // Store recent positions for trail rendering
        n.trailLength = n.anchor ? 25 : 15; // State nodes have longer trails
      }
    });

    // Signal pulses flowing along inference paths
    const pulses = [
      { pi: 0, t: 0.0, sp: 0.0042 }, // Core to Focus
      { pi: 2, t: 0.25, sp: 0.0038 }, // Core to Confusion
      { pi: 4, t: 0.5, sp: 0.0045 }, // Core to Recovery
      { pi: 6, t: 0.15, sp: 0.0048 }, // Focus → Confusion
      { pi: 7, t: 0.65, sp: 0.0041 }, // Confusion → Fatigue
      { pi: 8, t: 0.85, sp: 0.0044 }, // Fatigue → Recovery
      { pi: 10, t: 0.35, sp: 0.0039 }, // Residue → Confusion
    ];

    let frame = 0,
      scanRing = 0,
      scanActive = false;

    // Ambient signal streams
    const streams = Array.from({ length: 7 }, (_, i) => ({
      y: (i / 7) * 0.88 + 0.06,
      sp: 0.0016 + Math.random() * 0.0014,
      x: Math.random(),
      al: 0.06 + Math.random() * 0.08,
    }));
    const TILT = 0.18;

    /* ── draw orbital rings ───────────────────────────────────── */
    const drawOrbitalRings = () => {
      const r = R();
      const cx = W / 2;
      const cy = H / 2 + 12;
      
      // Draw concentric orbital rings with subtle breathing animation
      [0.25, 0.37, 0.49, 0.61, 0.72, 0.85, 0.88].forEach((mult, i) => {
        const ringR = r * mult * (1 + Math.sin(frame * 0.0008 + i * 0.4) * 0.015);
        ctx.beginPath();
        ctx.ellipse(cx, cy, ringR, ringR * 0.7, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,232,122,${0.06 + i * 0.015})`;
        ctx.lineWidth = 0.5;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    };

    /* ── draw orbital trails ──────────────────────────────────── */
    const drawTrails = (pr) => {
      pr.forEach((n) => {
        if (!n.trail || n.trail.length < 2) return;
        
        // Determine trail color based on node type
        let trailColor = "0,232,122"; // default green
        if (n.state === "confusion") trailColor = "239,68,68";
        else if (n.state === "fatigue") trailColor = "245,158,11";
        else if (n.state === "residue") trailColor = "234,179,8";
        else if (n.state === "recovery") trailColor = "34,197,94";
        
        // Draw trail as connected segments with fading opacity
        for (let i = 1; i < n.trail.length; i++) {
          const prev = n.trail[i - 1];
          const curr = n.trail[i];
          const alpha = (i / n.trail.length) * (n.anchor ? 0.28 : 0.15);
          
          ctx.beginPath();
          ctx.moveTo(prev.sx, prev.sy);
          ctx.lineTo(curr.sx, curr.sy);
          ctx.strokeStyle = `rgba(${trailColor},${alpha})`;
          ctx.lineWidth = n.anchor ? 1.4 : 0.6;
          ctx.stroke();
        }
      });
    };

    /* ── draw external state labels ───────────────────────────── */
    const drawExternalLabels = (pr) => {
      pr.forEach((n) => {
        if (!n.anchor || !n.label) return;
        
        let stateColor = "0,232,122";
        if (n.state === "core") {
          stateColor = "0,232,122";
        } else if (n.state === "confusion") {
          stateColor = "239,68,68";
        } else if (n.state === "fatigue") {
          stateColor = "245,158,11";
        } else if (n.state === "residue") {
          stateColor = "234,179,8";
        } else if (n.state === "recovery") {
          stateColor = "34,197,94";
        }
        
        if (n.state === "core") {
          // Core label below
          ctx.font = "700 11px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = `rgba(${stateColor}, 0.85)`;
          ctx.fillText(n.label.toUpperCase(), n.sx, n.sy + 42);
          return;
        }
        
        // Calculate label position outside the node
        const angle = Math.atan2(n.sy - H / 2, n.sx - W / 2);
        const labelDist = 48;
        const lx = n.sx + Math.cos(angle) * labelDist;
        const ly = n.sy + Math.sin(angle) * labelDist;
        
        // Draw connection line from node to label
        ctx.beginPath();
        ctx.moveTo(n.sx, n.sy);
        ctx.lineTo(lx, ly);
        ctx.strokeStyle = `rgba(${stateColor}, 0.3)`;
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Draw label background
        ctx.font = "600 10px 'IBM Plex Mono', monospace";
        const textWidth = ctx.measureText(n.label).width;
        const padding = 6;
        ctx.fillStyle = `rgba(${stateColor}, 0.12)`;
        ctx.fillRect(lx - textWidth / 2 - padding, ly - 8, textWidth + padding * 2, 16);
        
        // Draw label text
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${stateColor}, 0.95)`;
        ctx.fillText(n.label, lx, ly + 3);
        
        // Draw intensity below label
        if (n.intensity) {
          ctx.font = "500 8px 'IBM Plex Mono', monospace";
          ctx.fillStyle = `rgba(${stateColor}, 0.6)`;
          ctx.fillText(`${n.intensity}%`, lx, ly + 14);
        }
      });
    };

    /* ── draw core energy beams ──────────────────────────────── */
    const drawCoreBeams = (pr) => {
      const core = pr[0];
      if (!core) return;
      
      // Draw radial energy beams to state nodes
      for (let i = 1; i <= 5; i++) {
        const state = pr[i];
        if (!state) continue;
        
        const pulse = Math.sin(frame * 0.02 + i * 0.8) * 0.5 + 0.5;
        
        // Main beam
        ctx.beginPath();
        ctx.moveTo(core.sx, core.sy);
        ctx.lineTo(state.sx, state.sy);
        
        const gradient = ctx.createLinearGradient(core.sx, core.sy, state.sx, state.sy);
        gradient.addColorStop(0, `rgba(0,232,122,${0.35 + pulse * 0.15})`);
        gradient.addColorStop(1, `rgba(0,232,122,0.08)`);
        
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2 + pulse * 0.8;
        ctx.stroke();
        
        // Animated energy particles along beam
        const particlePos = (frame * 0.003 + i * 0.2) % 1;
        const px = core.sx + (state.sx - core.sx) * particlePos;
        const py = core.sy + (state.sy - core.sy) * particlePos;
        
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,232,122,${0.8 - particlePos * 0.5})`;
        ctx.fill();
      }
    };

    /* ── draw inference lattice (curved paths) ────────────────── */
    const drawLattice = (pr) => {
      paths.forEach((p) => {
        const a = pr[p.a];
        const b = pr[p.b];
        if (!a || !b) return;

        // Create curved path using quadratic bezier
        const mx = (a.sx + b.sx) / 2;
        const my = (a.sy + b.sy) / 2;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const cpx = mx - dy * p.curve;
        const cpy = my + dx * p.curve;

        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        if (p.curve !== 0) {
          ctx.quadraticCurveTo(cpx, cpy, b.sx, b.sy);
        } else {
          ctx.lineTo(b.sx, b.sy);
        }

        if (p.type === "core") {
          // Skip core connections - handled by energy beams
          return;
        } else if (p.type === "transition") {
          ctx.strokeStyle = "rgba(0,232,122,0.5)";
          ctx.lineWidth = 2.2;
          ctx.stroke();
          
          // Draw directional arrow
          const t = 0.65;
          const it = 1 - t;
          const arrowX = it * it * a.sx + 2 * it * t * cpx + t * t * b.sx;
          const arrowY = it * it * a.sy + 2 * it * t * cpy + t * t * b.sy;
          
          const angle = Math.atan2(b.sy - a.sy, b.sx - a.sx);
          const arrowSize = 6;
          
          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(arrowX - arrowSize * Math.cos(angle - 0.4), arrowY - arrowSize * Math.sin(angle - 0.4));
          ctx.lineTo(arrowX - arrowSize * Math.cos(angle + 0.4), arrowY - arrowSize * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fillStyle = "rgba(0,232,122,0.7)";
          ctx.fill();
          
        } else if (p.type === "drift") {
          ctx.setLineDash([6, 5]);
          ctx.strokeStyle = "rgba(245,158,11,0.45)";
          ctx.lineWidth = 1.8;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    };

    /* ── state risk pulse (replaces scan ring) ────────────────── */
    const drawRiskPulse = (pr) => {
      if (!scanActive) return;
      // Pulse from confusion node (index 2 - after core at 0 and focus at 1)
      const confNode = pr[2];
      if (!confNode) return;
      const maxR = R() * 0.7;
      [1, 0.7, 0.45].forEach((mult, i) => {
        const t = Math.max(0, scanRing - i * 0.11);
        if (t <= 0) return;
        const ringR = t * maxR * mult;
        const alpha = (1 - t) * (0.35 - i * 0.09);
        if (alpha <= 0) return;
        ctx.beginPath();
        ctx.arc(confNode.sx, confNode.sy, ringR, 0, 6.28);
        ctx.strokeStyle = `rgba(239,68,68,${alpha})`;
        ctx.lineWidth = i === 0 ? 1.6 : 0.8;
        ctx.stroke();
      });
    };

    /* ── HUD corners + readouts ───────────────────────────────── */
    const drawHUD = () => {
      const pad = 12;
      // corner L-brackets
      ctx.strokeStyle = "rgba(0,232,122,.23)";
      ctx.lineWidth = 1.1;
      [
        [pad, pad, 1, 1],
        [W - pad, pad, -1, 1],
        [pad, H - pad, 1, -1],
        [W - pad, H - pad, -1, -1],
      ].forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * 16, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * 16);
        ctx.stroke();
      });

      // top-left info
      ctx.font = "500 8px 'IBM Plex Mono',monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(0,232,122,.42)";
      ctx.fillText("NEUROTRACE // COGNITIVE FIELD", pad + 3, pad + 20);
      ctx.fillStyle = "rgba(0,232,122,.22)";
      ctx.fillText(
        `STATES: ${5}  TRACES: ${nodes.length}`,
        pad + 3,
        pad + 32,
      );
      ctx.fillText(
        `INFERENCE: ${String(frame % 1000).padStart(4, "0")}`,
        pad + 3,
        pad + 44,
      );

      // top-right alert
      ctx.textAlign = "right";
      ctx.font = "700 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = "rgba(239,68,68,.72)";
      ctx.fillText("⚠ CONFUSION RISK", W - pad - 3, pad + 20);
      ctx.font = "500 8px 'IBM Plex Mono',monospace";
      ctx.fillStyle = "rgba(239,68,68,.42)";
      ctx.fillText("INTENSITY: 87%", W - pad - 3, pad + 32);
      ctx.fillText("FATIGUE DRIFT DETECTED", W - pad - 3, pad + 44);

      // bottom state flow chain
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,232,122,.17)";
      ctx.font = "400 8px 'IBM Plex Mono',monospace";
      ctx.fillText("PASSIVE SIGNALS ACTIVE · STATE INFERENCE ONGOING", W / 2, H - pad - 3);

      // inference progress bar
      const bw = 70,
        bX = W / 2 - 35,
        bY = H - pad - 15;
      ctx.fillStyle = "rgba(0,232,122,.08)";
      ctx.fillRect(bX, bY, bw, 2);
      ctx.fillStyle = "rgba(0,232,122,.48)";
      ctx.fillRect(bX, bY, bw * ((frame % 160) / 160), 2);
    };

    /* ── main render loop ─────────────────────────────────────── */
    let raf;
    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);

      // trigger risk pulse every 160 frames
      if (frame % 160 === 0) {
        scanActive = true;
        scanRing = 0.01;
      }
      if (scanActive) {
        scanRing += 0.012;
        if (scanRing >= 1.05) {
          scanActive = false;
          scanRing = 0;
        }
      }

      pulses.forEach((p) => {
        p.t = (p.t + p.sp) % 1;
      });

      // ambient signal streams
      streams.forEach((s) => {
        s.x = (s.x + s.sp) % 1.3;
        const x = s.x * W,
          y = s.y * H;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 24, y + 9);
        ctx.strokeStyle = `rgba(0,232,122,${s.al})`;
        ctx.lineWidth = 0.4;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, 6.28);
        ctx.fillStyle = `rgba(0,232,122,${s.al * 1.6})`;
        ctx.fill();
      });

      // Draw orbital ring structure first
      drawOrbitalRings();

      // Update orbital positions and project all nodes
      const r = R();
      const pr = nodes.map((n) => {
        let ox, oy, oz;
        
        if (n.stationary) {
          // Core stays at origin
          ox = n.ox;
          oy = n.oy;
          oz = n.oz;
        } else {
          // Update orbital angle based on orbital speed
          n.orbitAngle += n.orbitSpeed;
          if (n.orbitAngle > Math.PI * 2) n.orbitAngle -= Math.PI * 2;
          
          // Calculate position on orbital ring
          const ringR = r * n.orbitRadius;
          ox = ringR * Math.cos(n.orbitAngle);
          oy = ringR * Math.sin(n.orbitAngle) * 0.7; // elliptical for perspective
          oz = n.oz; // maintain z-layer
        }
        
        // Apply subtle 3D tilt for depth (but no rotation - nodes orbit on rings)
        let p = rx(ox, oy, oz, TILT);
        const projected = { ...n, ...prj(p.x, p.y, p.z) };
        
        // Record position in trail (every frame for anchors, every 2 frames for particles)
        if (!n.stationary && (n.anchor || frame % 2 === 0)) {
          if (!n.trail) n.trail = [];
          n.trail.push({ sx: projected.sx, sy: projected.sy });
          if (n.trail.length > n.trailLength) n.trail.shift();
        }
        
        return projected;
      });

      // Draw orbital trails first (behind everything)
      drawTrails(pr);

      // Draw core energy beams (radial connections)
      drawCoreBeams(pr);

      // draw inference lattice (state transitions)
      drawLattice(pr);

      drawRiskPulse(pr);

      // draw signal pulses along paths
      pulses.forEach((p) => {
        const path = paths[p.pi];
        if (!path) return;
        const a = pr[path.a];
        const b = pr[path.b];
        if (!a || !b) return;

        // Calculate point on curved path using quadratic bezier
        const t = p.t;
        const mx = (a.sx + b.sx) / 2;
        const my = (a.sy + b.sy) / 2;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const cpx = mx - dy * path.curve;
        const cpy = my + dx * path.curve;

        // Quadratic bezier formula: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
        const it = 1 - t;
        const px = it * it * a.sx + 2 * it * t * cpx + t * t * b.sx;
        const py = it * it * a.sy + 2 * it * t * cpy + t * t * b.sy;

        // Draw pulse
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, 6.28);
        ctx.fillStyle = "rgba(0,232,122,.08)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, 6.28);
        ctx.fillStyle = "rgba(0,232,122,.92)";
        ctx.fill();
        // subtle glow
        ctx.beginPath();
        ctx.arc(px - 0.5, py - 0.5, 0.9, 0, 6.28);
        ctx.fillStyle = "rgba(180,255,200,.5)";
        ctx.fill();
      });

      // draw nodes — painter's algorithm (back → front)
      [...pr]
        .sort((a, b) => a.z - b.z)
        .forEach((n) => {
          const pulse = Math.sin(frame * 0.022 + n.ph);
          
          if (n.anchor) {
            let stateColor = "0,232,122";
            let sz = n.r * Math.max(0.75, n.scale) * 2;
            
            if (n.state === "core") {
              // CENTRAL INFERENCE CORE - dominant focal point
              stateColor = "0,232,122";
              sz = n.r * Math.max(0.85, n.scale) * 2.5;
              
              // Multi-layer glow aura
              for (let i = 4; i >= 1; i--) {
                ctx.beginPath();
                ctx.arc(n.sx, n.sy, sz + 22 + i * 10 + pulse * 7, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(${stateColor},${(0.1 / i) + pulse * 0.025})`;
                ctx.lineWidth = 2.2 - i * 0.4;
                ctx.stroke();
              }
              
              // Outer glow halo
              const gradient = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, sz + 15);
              gradient.addColorStop(0, `rgba(${stateColor},0.18)`);
              gradient.addColorStop(0.6, `rgba(${stateColor},0.08)`);
              gradient.addColorStop(1, `rgba(${stateColor},0)`);
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz + 15, 0, Math.PI * 2);
              ctx.fill();
              
              // Main core sphere
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${stateColor},.28)`;
              ctx.fill();
              ctx.strokeStyle = `rgba(${stateColor},.98)`;
              ctx.lineWidth = 3;
              ctx.stroke();
              
              // Bright inner core with pulse
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz * 0.55, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${stateColor},${0.65 + pulse * 0.18})`;
              ctx.fill();
              
              // Core center dot
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz * 0.2, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(255,255,255,${0.8 + pulse * 0.2})`;
              ctx.fill();
              
            } else {
              // STATE NODES - professional and clear
              if (n.state === "confusion") stateColor = "239,68,68";
              else if (n.state === "fatigue") stateColor = "245,158,11";
              else if (n.state === "residue") stateColor = "234,179,8";
              else if (n.state === "recovery") stateColor = "34,197,94";
              
              sz = n.r * Math.max(0.75, n.scale) * 1.85;
              
              // Outer glow halo
              const gradient = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, sz + 12);
              gradient.addColorStop(0, `rgba(${stateColor},0.15)`);
              gradient.addColorStop(0.7, `rgba(${stateColor},0.05)`);
              gradient.addColorStop(1, `rgba(${stateColor},0)`);
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz + 12, 0, Math.PI * 2);
              ctx.fill();
              
              // Outer pulse ring
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz + 14 + pulse * 6, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(${stateColor},${0.18 + pulse * 0.08})`;
              ctx.lineWidth = 1.6;
              ctx.stroke();
              
              // Main state sphere
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${stateColor},.26)`;
              ctx.fill();
              ctx.strokeStyle = `rgba(${stateColor},.95)`;
              ctx.lineWidth = 2.4;
              ctx.stroke();
              
              // Inner glowing core
              ctx.beginPath();
              ctx.arc(n.sx, n.sy, sz * 0.5, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${stateColor},${0.55 + pulse * 0.18})`;
              ctx.fill();
              
              // State ID (compact code)
              ctx.font = "700 9px 'IBM Plex Mono',monospace";
              ctx.textAlign = "center";
              ctx.fillStyle = "rgba(255,255,255,.95)";
              ctx.fillText(n.id, n.sx, n.sy + 2.8);
            }
          } else {
            // Signal trace particles - subtle but visible
            const sz = n.r * Math.max(0.6, n.scale);
            
            // Soft glow
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz + 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,232,122,${0.04 + n.scale * 0.03})`;
            ctx.fill();
            
            // Main particle
            ctx.beginPath();
            ctx.arc(n.sx, n.sy, sz, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,232,122,${0.08 + n.scale * 0.06})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(0,232,122,${0.15 + pulse * 0.06})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        });

      // Draw external labels on top
      drawExternalLabels(pr);

      drawHUD();
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={cvs}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
};

// ══════════════════════════════════════════════════════════════════
//  HeroSection — two-column layout: text left, 3-D orb right
// ══════════════════════════════════════════════════════════════════
const HeroSection = () => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 120);
    return () => clearTimeout(t);
  }, []);

  /* ── background particle canvas (same logic, slightly dimmer) ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const primary = "0,232,122",
      danger = "239,68,68";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const W = () => canvas.offsetWidth,
      H = () => canvas.offsetHeight;

    const nodes = Array.from({ length: 22 }, (_, i) => ({
      x: Math.random() * W(),
      y: Math.random() * H(),
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      r: Math.random() * 2.2 + 1.4,
      flagged: i < 3,
      phase: Math.random() * Math.PI * 2,
    }));
    nodes[0] = {
      ...nodes[0],
      x: W() * 0.5,
      y: H() * 0.44,
      r: 5,
      flagged: true,
    };
    nodes[1] = {
      ...nodes[1],
      x: W() * 0.43,
      y: H() * 0.56,
      r: 4.2,
      flagged: true,
      vx: -0.09,
      vy: 0.07,
    };
    nodes[2] = {
      ...nodes[2],
      x: W() * 0.57,
      y: H() * 0.56,
      r: 4.2,
      flagged: true,
      vx: 0.07,
      vy: -0.11,
    };
    const loop = [nodes[0], nodes[1], nodes[2]];
    const cpts = [
      { t: 0, sp: 0.0042 },
      { t: 0.33, sp: 0.0055 },
      { t: 0.67, sp: 0.0036 },
    ];
    const lerp = (a, b, t) => a + (b - a) * t;
    const getCP = (t) => {
      const s = Math.floor(t * 3) % 3,
        st = (t * 3) % 1,
        f = loop[s],
        to = loop[(s + 1) % 3];
      return { x: lerp(f.x, to.x, st), y: lerp(f.y, to.y, st) };
    };

    let frame = 0;
    const draw = () => {
      frame++;
      const w = W(),
        h = H();
      ctx.clearRect(0, 0, w, h);
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 16 || n.x > w - 16) n.vx *= -1;
        if (n.y < 16 || n.y > h - 16) n.vy *= -1;
      });
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const d = Math.hypot(
            nodes[i].x - nodes[j].x,
            nodes[i].y - nodes[j].y,
          );
          if (d > 155) continue;
          const alpha = (1 - d / 155) * 0.09,
            sus = nodes[i].flagged && nodes[j].flagged;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.setLineDash(sus ? [5, 4] : []);
          ctx.strokeStyle = sus
            ? `rgba(${danger},${alpha * 4})`
            : `rgba(${primary},${alpha})`;
          ctx.lineWidth = sus ? 1.3 : 0.65;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      cpts.forEach((p) => {
        p.t = (p.t + p.sp) % 1;
        const pt = getCP(p.t);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.4, 0, 6.28);
        ctx.fillStyle = `rgba(${danger},.88)`;
        ctx.fill();
      });
      nodes.forEach((n) => {
        const pulse = Math.sin(frame * 0.022 + n.phase);
        if (n.flagged) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 8 + pulse * 4, 0, 6.28);
          ctx.strokeStyle = `rgba(${danger},${0.08 + pulse * 0.03})`;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, 6.28);
          ctx.fillStyle = `rgba(${danger},.18)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${danger},.7)`;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, 6.28);
          ctx.fillStyle = `rgba(${primary},.05)`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${primary},${0.18 + pulse * 0.05})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      });
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      window.removeEventListener("resize", resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const stagger = (i) => ({
    opacity: loaded ? 1 : 0,
    transform: loaded ? "translateY(0)" : "translateY(24px)",
    transition: `opacity .62s ease ${i * 95}ms, transform .62s ease ${i * 95}ms`,
  });

  return (
    <>
      <style>{`
        @keyframes hero-blink { 0%,100%{opacity:1} 50%{opacity:.18} }
        @keyframes orb-glow   { 0%,100%{box-shadow:0 0 32px rgba(0,232,122,.07),0 28px 80px rgba(0,0,0,.45)} 50%{box-shadow:0 0 60px rgba(0,232,122,.15),0 28px 80px rgba(0,0,0,.45)} }
        .hero-grid { display:grid; grid-template-columns:1fr; gap:32px; align-items:center; width:100%; max-width:1180px; margin:0 auto; padding:86px 28px 40px; position:relative; z-index:10; }
        @media(min-width:900px){ .hero-grid{ grid-template-columns:1fr 1fr; gap:52px; } .hero-text{ text-align:left!important; } .hero-row{ justify-content:flex-start!important; } }
        .orb-wrap { animation: orb-glow 4s ease infinite; }
        .sec-btn:hover { border-color:rgba(var(--primary-rgb),.5)!important; color:var(--foreground)!important; }
      `}</style>

      <section
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        {/* video */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          style={{ zIndex: 0, opacity: 0.2 }}
        >
          <source src="/bg-video-graphP.webm" type="video/webm" />
        </video>

        {/* particle bg canvas */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0.36,
            zIndex: 1,
          }}
        />

        {/* overlays */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
            backgroundImage:
              "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.022) 2px,rgba(0,0,0,.022) 4px)",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse 900px 600px at 50% 46%,rgba(var(--primary-rgb),.055) 0%,transparent 65%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-background/45"
          style={{ zIndex: 2 }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "0 0 auto",
            height: 110,
            background:
              "linear-gradient(to bottom,var(--background),transparent)",
            zIndex: 3,
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "auto 0 0",
            height: 110,
            background: "linear-gradient(to top,var(--background),transparent)",
            zIndex: 3,
          }}
        />

        {/* ── grid ──────────────────────────────────────────── */}
        <div className="hero-grid">
          {/* LEFT: text */}
          <div className="hero-text" style={{ textAlign: "center" }}>
            <h1
              style={{
                ...stagger(1),
                fontFamily:
                  "var(--font-serif,'Playfair Display',Georgia,serif)",
                fontSize: "clamp(36px,5vw,64px)",
                lineHeight: 1.06,
                letterSpacing: "-.022em",
                color: "var(--foreground)",
                marginBottom: 20,
              }}
            >
              See cognitive friction
              <br />
              <em
                style={{
                  fontStyle: "italic",
                  color: "var(--primary)",
                  fontWeight: 400,
                }}
              >
                before
              </em>
              <span style={{ fontWeight: 900 }}> it becomes a mistake.</span>
            </h1>

            <p
              style={{
                ...stagger(2),
                fontSize: 16,
                lineHeight: 1.76,
                color: "var(--muted-foreground)",
                maxWidth: 460,
                margin: "0 auto 32px",
              }}
            >
              NeuroTrace transforms interaction patterns into
              explainable signals of focus, confusion, fatigue, and recovery
              need — surfacing hidden cognitive friction before it becomes
              visible failure.
            </p>

            <div
              className="hero-row"
              style={{
                ...stagger(3),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                marginBottom: 42,
              }}
            >
              <a
                href="#demo"
                className="btn-primary btn-glow animate-glow-pulse"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  padding: "13px 30px",
                  letterSpacing: ".035em",
                }}
              >
                See It in Action ↗
              </a>
              <a
                href="#how-it-works"
                className="sec-btn"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "13px 22px",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: ".02em",
                  transition: "all .2s ease",
                  border: "1px solid rgba(var(--primary-rgb),.2)",
                  color: "var(--muted-foreground)",
                }}
              >
                How it works
              </a>
              <a
                href="#features"
                className="sec-btn"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "13px 22px",
                  borderRadius: 8,
                  textDecoration: "none",
                  letterSpacing: ".02em",
                  transition: "all .2s ease",
                  border: "1px solid rgba(var(--primary-rgb),.2)",
                  color: "var(--muted-foreground)",
                }}
              >
                Explore Features
              </a>
            </div>

            <div
              className="hero-row"
              style={{
                ...stagger(4),
                display: "flex",
                justifyContent: "center",
                borderTop: "1px solid rgba(var(--primary-rgb),.1)",
                paddingTop: 24,
              }}
            >
              {STATS.map((s, i) => (
                <div
                  key={i}
                  style={{
                    padding: "0 22px",
                    textAlign: "center",
                    borderRight:
                      i < STATS.length - 1
                        ? "1px solid rgba(var(--primary-rgb),.08)"
                        : "none",
                  }}
                >
                  <div
                    style={{
                      fontFamily:
                        "var(--font-serif,'Playfair Display',Georgia,serif)",
                      fontSize: 23,
                      fontWeight: 700,
                      lineHeight: 1.1,
                      color: "var(--primary)",
                      letterSpacing: "-.02em",
                    }}
                  >
                    {s.value}
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono',monospace",
                      fontSize: 9,
                      letterSpacing: ".1em",
                      color: "var(--muted-foreground)",
                      marginTop: 4,
                      textTransform: "uppercase",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: 3D orb */}
          <div style={{ ...stagger(1), width: "100%", minHeight: 0 }}>
            <div
              className="orb-wrap"
              style={{
                position: "relative",
                height: 500,
                borderRadius: 16,
                overflow: "hidden",
                background: "transparent",
              }}
            >
              {/* corner SVG brackets */}
              {[
                { pos: { top: 10, left: 10 }, d: "M 0 17 L 0 0 L 17 0" },
                { pos: { top: 10, right: 10 }, d: "M 0 0 L 17 0 L 17 17" },
                { pos: { bottom: 10, left: 10 }, d: "M 0 0 L 0 17 L 17 17" },
                { pos: { bottom: 10, right: 10 }, d: "M 17 0 L 17 17 L 0 17" },
              ].map((b, i) => (
                <svg
                  key={i}
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  style={{
                    position: "absolute",
                    pointerEvents: "none",
                    zIndex: 4,
                    ...b.pos,
                  }}
                >
                  <path
                    d={b.d}
                    fill="none"
                    stroke="rgba(0,232,122,.32)"
                    strokeWidth="1.3"
                  />
                </svg>
              ))}

              <CognitiveField />

              {/* bottom fade */}
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 48,
                  zIndex: 3,
                  pointerEvents: "none",
                  background:
                    "linear-gradient(to top,rgba(0,0,0,.3),transparent)",
                }}
              />
            </div>

            <p
              style={{
                textAlign: "center",
                marginTop: 9,
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: 9,
                color: "var(--muted-foreground)",
                letterSpacing: ".08em",
                opacity: 0.55,
              }}
            >
              NEUROTRACE INFERENCE FIELD · STATE TRANSITIONS · PASSIVE SIGNAL FLOW
            </p>
          </div>
        </div>

        {/* scroll hint */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 7,
            opacity: loaded ? 0.38 : 0,
            transition: "opacity 1s ease 1.3s",
          }}
        >
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 9,
              letterSpacing: ".18em",
              color: "var(--muted-foreground)",
            }}
          >
            SCROLL
          </span>
          <div
            style={{
              width: 1,
              height: 28,
              background:
                "linear-gradient(to bottom,var(--muted-foreground),transparent)",
            }}
          />
        </div>
      </section>
    </>
  );
};

export default HeroSection;
