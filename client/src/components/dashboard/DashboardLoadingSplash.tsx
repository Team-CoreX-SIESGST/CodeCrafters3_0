'use client';

import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────
   DashboardLoadingSplash
   Full-screen loader that COVERS the entire page area.
   Animation: EEG Brain-Scanner — hexagonal grid cells that light up
   progressively + dual waveform EEG lines + rotating sonar sweep
   + floating metric chips + central pulsing HUD ring.
   Completely different visual language from HeroSection.
───────────────────────────────────────────────────────────────── */
interface Props {
  onDone: () => void;
  minDuration?: number;
  dataReady?: boolean;
}

const STEPS = [
  { label: 'Connecting to MongoDB…',       pct: 12  },
  { label: 'Fetching cognitive snapshots…', pct: 30  },
  { label: 'Building observer graph…',      pct: 52  },
  { label: 'Computing score averages…',     pct: 68  },
  { label: 'Mapping state transitions…',    pct: 83  },
  { label: 'Rendering analytics…',          pct: 94  },
  { label: 'Dashboard ready.',              pct: 100 },
];

const METRICS = ['FOCUS', 'CONFUSION', 'FATIGUE', 'RESIDUE', 'RECOVERY', 'INTERRUPTIBILITY'];
const METRIC_COLS = ['#34b27b', '#ef4444', '#f59e0b', '#fbbf24', '#22d3ee', '#a78bfa'];

export default function DashboardLoadingSplash({ onDone, minDuration = 2800, dataReady = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx]     = useState(0);
  const [fadeOut, setFadeOut]     = useState(false);
  const [metricVals, setMetricVals] = useState(METRICS.map(() => Math.random() * 0.6 + 0.1));

  /* ── progress ticker ────────────────────────────────────── */
  useEffect(() => {
    let pct = 0;
    const id = setInterval(() => {
      pct = Math.min(100, pct + Math.random() * 2.8 + 0.8);
      setProgress(pct);
      const si = STEPS.findIndex(s => s.pct >= Math.round(pct));
      setStepIdx(Math.max(0, si === -1 ? STEPS.length - 1 : si));
    }, 55);
    return () => clearInterval(id);
  }, []);

  /* ── animate metric values ──────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => {
      setMetricVals(v => v.map(x => Math.max(0.05, Math.min(0.98, x + (Math.random() - 0.5) * 0.08))));
    }, 280);
    return () => clearInterval(id);
  }, []);

  /* ── exit sequence ──────────────────────────────────────── */
  useEffect(() => {
    if (!dataReady) return;
    const id = setTimeout(() => setFadeOut(true), Math.max(0, minDuration - 400));
    return () => clearTimeout(id);
  }, [dataReady, minDuration]);

  useEffect(() => {
    if (!fadeOut) return;
    const id = setTimeout(onDone, 500);
    return () => clearTimeout(id);
  }, [fadeOut, onDone]);

  /* ═══════════════════════════════════════════════════════════
     CANVAS — HEX GRID + SONAR SWEEP + EEG WAVEFORMS
  ══════════════════════════════════════════════════════════ */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0, H = 0, raf = 0, frame = 0;

    const resize = () => {
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    /* ── Hex grid ───────────────────────────────────────── */
    const HEX_R  = 28; // outer radius of each hex
    const HEX_H  = HEX_R * Math.sqrt(3);
    const cols   = Math.ceil(W / (HEX_R * 1.5)) + 2;
    const rows   = Math.ceil(H / HEX_H) + 2;
    const totalHex = cols * rows;

    // Precompute hex metadata
    const hexes: { cx: number; cy: number; glow: number; target: number; col: string; lit: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = c * HEX_R * 1.5 - HEX_R;
        const cy = r * HEX_H + (c % 2 === 0 ? 0 : HEX_H / 2) - HEX_H / 2;
        const angle = Math.atan2(cy - H / 2, cx - W / 2);
        const dist  = Math.hypot(cx - W / 2, cy - H / 2);
        // pick color family by quadrant
        const qi = ((Math.floor((angle + Math.PI) / (Math.PI / 3))) % 6);
        const palettes = ['0,232,122','106,169,255','239,68,68','245,158,11','162,139,250','34,211,238'];
        hexes.push({ cx, cy, glow: 0, target: 0, col: palettes[qi], lit: Math.random() * 2000 + dist * 1.2 });
      }
    }

    /* ── EEG waveform history ─────────────────────────────── */
    const EEG_LINES = 3;
    const eegHistory: number[][] = Array.from({ length: EEG_LINES }, () => []);
    const eegCols   = ['rgba(0,232,122,0.7)', 'rgba(106,169,255,0.5)', 'rgba(239,68,68,0.4)'];
    const eegFreqs  = [0.018, 0.031, 0.051];
    const eegAmps   = [0.13, 0.09, 0.06];

    /* ── sonar sweep state ────────────────────────────────── */
    let sonarAngle = -Math.PI / 2;

    /* ── draw a single hexagon ────────────────────────────── */
    const hex = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 6;
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);

      /* ── background radial vignette ─────────────────────── */
      const vg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.75);
      vg.addColorStop(0,   'rgba(5,15,28,0)');
      vg.addColorStop(0.6, 'rgba(3,9,18,0.3)');
      vg.addColorStop(1,   'rgba(1,4,10,0.85)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      /* ── sonar sweep advance ──────────────────────────────── */
      sonarAngle += 0.012;
      if (sonarAngle > Math.PI * 2 - Math.PI / 2) sonarAngle -= Math.PI * 2;

      /* ── update hex glows based on sonar ────────────────── */
      hexes.forEach(h => {
        const hAngle = Math.atan2(h.cy - H/2, h.cx - W/2);
        // normalise angles
        const sa = ((sonarAngle % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
        const ha = (hAngle + Math.PI*2) % (Math.PI*2);
        const diff = ((sa - ha + Math.PI*2) % (Math.PI*2));
        const isInBeam = diff < 0.55;
        if (isInBeam) {
          h.glow = 1.0;
          // spontaneously assign a random high target
          h.target = 0.5 + Math.random() * 0.5;
        } else {
          h.glow = Math.max(0, h.glow - 0.022);
          h.target = Math.max(0, h.target - 0.008);
        }
        // lit-up based on frame threshold (staggered boot)
        if (frame > h.lit / 16) {
          h.target = Math.max(h.target, 0.04 + Math.random() * 0.03);
        }
      });

      /* ── draw hex grid ───────────────────────────────────── */
      hexes.forEach(h => {
        const alpha = h.glow * 0.6 + h.target;
        if (alpha < 0.005) return;
        hex(h.cx, h.cy, HEX_R - 1.5);
        ctx.strokeStyle = `rgba(${h.col},${Math.min(0.7, alpha + 0.04)})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
        if (alpha > 0.1) {
          ctx.fillStyle = `rgba(${h.col},${Math.min(0.22, alpha * 0.35)})`;
          ctx.fill();
        }
        // dot at center for active hexes
        if (h.glow > 0.3) {
          ctx.beginPath(); ctx.arc(h.cx, h.cy, 2.5, 0, Math.PI*2);
          ctx.fillStyle = `rgba(${h.col},${h.glow * 0.9})`; ctx.fill();
        }
      });

      /* ── sonar cone (gradient sweep) ────────────────────── */
      const sonarR = Math.max(W, H);
      const SWEEP_WIDTH = Math.PI / 8;
      const startA = sonarAngle - SWEEP_WIDTH;
      ctx.beginPath();
      ctx.moveTo(W/2, H/2);
      ctx.arc(W/2, H/2, sonarR, startA, sonarAngle);
      ctx.closePath();
      const sonarFill = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, sonarR * 0.8);
      sonarFill.addColorStop(0,   'rgba(0,232,122,0.08)');
      sonarFill.addColorStop(0.7, 'rgba(0,232,122,0.03)');
      sonarFill.addColorStop(1,   'rgba(0,232,122,0)');
      ctx.fillStyle = sonarFill;
      ctx.fill();
      // leading edge bright line
      ctx.beginPath();
      ctx.moveTo(W/2, H/2);
      ctx.lineTo(W/2 + sonarR * Math.cos(sonarAngle), H/2 + sonarR * Math.sin(sonarAngle));
      ctx.strokeStyle = 'rgba(0,232,122,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* ── concentric sonar rings ──────────────────────────── */
      [0.22, 0.38, 0.55, 0.72, 0.90].forEach((mult, i) => {
        ctx.beginPath();
        ctx.arc(W/2, H/2, Math.max(W,H) * 0.55 * mult, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(0,232,122,${0.06 + i*0.01})`;
        ctx.lineWidth = 0.6;
        ctx.setLineDash([4, 8]); ctx.stroke(); ctx.setLineDash([]);
      });

      /* ── crosshair lines through centre ─────────────────── */
      [[W/2, 0, W/2, H], [0, H/2, W, H/2]].forEach(([x1, y1, x2, y2]) => {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        ctx.strokeStyle = 'rgba(0,232,122,0.07)'; ctx.lineWidth = 0.8; ctx.stroke();
      });

      /* ── EEG waveforms (2 horizontal bands) ─────────────── */
      for (let li = 0; li < EEG_LINES; li++) {
        const yBase = H * (0.72 + li * 0.07);
        const val = Math.sin(frame * eegFreqs[li] * Math.PI * 2) * eegAmps[li] * H
                  + Math.sin(frame * eegFreqs[li] * 1.7 * Math.PI * 2) * eegAmps[li] * 0.4 * H;
        eegHistory[li].push(val);
        if (eegHistory[li].length > W) eegHistory[li].shift();

        ctx.beginPath();
        eegHistory[li].forEach((v, x) => {
          const px = x, py = yBase + v;
          x === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.strokeStyle = eegCols[li]; ctx.lineWidth = 1.2; ctx.stroke();
      }

      /* ── top EEG spike burst (random) ───────────────────── */
      if (frame % 35 === 0) {
        // randomise spike positions in eegHistory[0]
        const spkIdx = Math.floor(Math.random() * eegHistory[0].length);
        if (eegHistory[0][spkIdx] !== undefined) {
          eegHistory[0][spkIdx] = (Math.random() > 0.5 ? 1 : -1) * H * 0.03;
        }
      }

      /* ── central bright dot + rings ─────────────────────── */
      const pulse = Math.sin(frame * 0.04) * 0.5 + 0.5;
      [60, 42, 28, 18].forEach((r, i) => {
        ctx.beginPath(); ctx.arc(W/2, H/2, r + pulse * 5, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(0,232,122,${0.08 + i * 0.06 + pulse * 0.04})`;
        ctx.lineWidth = 1 + i * 0.3; ctx.stroke();
      });
      ctx.beginPath(); ctx.arc(W/2, H/2, 7 + pulse * 2, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,232,122,${0.7 + pulse * 0.3})`; ctx.fill();
      ctx.beginPath(); ctx.arc(W/2, H/2, 3, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();

      /* ── blip dots along sonar hits ─────────────────────── */
      for (let i = 0; i < 4; i++) {
        const angle = sonarAngle - i * 0.18;
        const dr = (Math.max(W,H)*0.55) * (0.2 + i * 0.18);
        const bx = W/2 + dr * Math.cos(angle);
        const by = H/2 + dr * Math.sin(angle);
        const br = (4 - i) * 1.2;
        const ba = Math.max(0, 0.8 - i * 0.18);
        ctx.beginPath(); ctx.arc(bx, by, br + 4, 0, Math.PI*2);
        ctx.fillStyle = `rgba(0,232,122,${ba * 0.12})`; ctx.fill();
        ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI*2);
        ctx.fillStyle = `rgba(0,232,122,${ba})`; ctx.fill();
      }

      /* ── HUD corner L-brackets ───────────────────────────── */
      const pad = 16;
      ctx.strokeStyle = 'rgba(0,232,122,0.28)'; ctx.lineWidth = 1.2;
      [[pad,pad,1,1],[W-pad,pad,-1,1],[pad,H-pad,1,-1],[W-pad,H-pad,-1,-1]].forEach(([x,y,sx,sy]) => {
        ctx.beginPath(); ctx.moveTo(x+sx*22,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*22); ctx.stroke();
      });

      /* ── HUD text labels ─────────────────────────────────── */
      ctx.font = "500 8px 'IBM Plex Mono', monospace"; ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(0,232,122,0.5)';
      ctx.fillText('NEUROTRACE // DASHBOARD BOOT', pad+4, pad+22);
      ctx.fillStyle = 'rgba(0,232,122,0.25)';
      ctx.fillText(`SWEEP: ${(sonarAngle * 180/Math.PI + 360).toFixed(1)}°`, pad+4, pad+36);
      ctx.fillText(`FRAME: ${String(frame%10000).padStart(5,'0')}`, pad+4, pad+50);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(106,169,255,0.65)';
      ctx.font = "700 8px 'IBM Plex Mono', monospace";
      ctx.fillText('◉ BRAIN SCANNER ACTIVE', W-pad-4, pad+22);
      ctx.font = "500 8px 'IBM Plex Mono', monospace";
      ctx.fillStyle = 'rgba(106,169,255,0.35)';
      ctx.fillText(`NODES: ${hexes.filter(h=>h.target>0.08).length} / ${totalHex}`, W-pad-4, pad+36);
      ctx.fillText('SIGNAL ACQUISITION…', W-pad-4, pad+50);

      /* ── bottom status bar ───────────────────────────────── */
      ctx.textAlign = 'center';
      ctx.font = "400 7px 'IBM Plex Mono', monospace";
      ctx.fillStyle = 'rgba(0,232,122,0.18)';
      ctx.fillText('COGNITIVE OBSERVER SYSTEM · PASSIVE MONITORING ACTIVE · ALL SIGNALS GREEN', W/2, H-pad-4);

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'linear-gradient(160deg,#020c16 0%,#050f1e 40%,#03080f 100%)',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s cubic-bezier(.4,0,.2,1)',
        pointerEvents: fadeOut ? 'none' : 'all',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'IBM Plex Mono', monospace",
      }}
    >
      {/* ── full-page canvas ─────────────────────────────── */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* scanline overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.05) 2px,rgba(0,0,0,0.05) 3px)',
      }} />

      {/* ── floating metric chips (top right cluster) ─────── */}
      <div style={{
        position: 'absolute', top: 80, right: 24,
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2,
      }}>
        {METRICS.map((m, i) => (
          <div key={m} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,0,0,0.45)', border: `1px solid ${METRIC_COLS[i]}30`,
            borderRadius: 6, padding: '5px 10px',
            backdropFilter: 'blur(6px)',
            animation: `fadeSlideIn 0.4s ease ${i * 0.08}s both`,
          }}>
            <span style={{ fontSize: 7, letterSpacing: '0.2em', color: METRIC_COLS[i], flex: 1 }}>{m}</span>
            {/* mini bar */}
            <div style={{ width: 48, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.round(metricVals[i] * 100)}%`,
                background: METRIC_COLS[i], borderRadius: 3,
                transition: 'width 0.3s ease',
                boxShadow: `0 0 6px ${METRIC_COLS[i]}`,
              }} />
            </div>
            <span style={{ fontSize: 8, color: METRIC_COLS[i], opacity: 0.8, minWidth: 28, textAlign: 'right' }}>
              {Math.round(metricVals[i] * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* ── centre bottom HUD ────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 60, left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
        zIndex: 2, minWidth: 320,
      }}>
        {/* step label */}
        <div style={{
          fontSize: 11, letterSpacing: '0.06em', color: 'rgba(255,255,255,0.65)',
          textAlign: 'center', minHeight: 16,
          transition: 'opacity 0.3s ease',
        }}>
          {STEPS[stepIdx]?.label}
        </div>

        {/* progress bar */}
        <div style={{
          width: 320, height: 3, background: 'rgba(0,232,122,0.1)',
          borderRadius: 99, overflow: 'hidden', position: 'relative',
        }}>
          {/* glow inner bar */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 99,
            background: 'rgba(0,232,122,0.06)',
            backgroundImage: 'repeating-linear-gradient(90deg,transparent,transparent 12px,rgba(0,232,122,0.08) 12px,rgba(0,232,122,0.08) 13px)',
          }} />
          <div style={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${progress}%`,
            background: 'linear-gradient(90deg,rgba(0,232,122,0.5) 0%,#00e87a 80%,rgba(180,255,220,1) 100%)',
            borderRadius: 99,
            boxShadow: '0 0 10px rgba(0,232,122,0.9), 0 0 24px rgba(0,232,122,0.4)',
            transition: 'width 0.1s ease-out',
          }} />
        </div>

        {/* pct + step dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 9, letterSpacing: '0.22em', color: 'rgba(0,232,122,0.55)' }}>
            {String(Math.round(progress)).padStart(3, '0')}%
          </span>
          <div style={{ display: 'flex', gap: 5 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{
                width: i <= stepIdx ? 14 : 5, height: 5,
                borderRadius: 99,
                background: i <= stepIdx ? '#00e87a' : 'rgba(255,255,255,0.1)',
                boxShadow: i === stepIdx ? '0 0 8px rgba(0,232,122,0.9)' : 'none',
                transition: 'all 0.3s ease',
              }} />
            ))}
          </div>
          <span style={{ fontSize: 9, letterSpacing: '0.18em', color: 'rgba(106,169,255,0.5)' }}>
            STEP {stepIdx+1}/{STEPS.length}
          </span>
        </div>
      </div>

      {/* ── top centre title ────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)',
        textAlign: 'center', zIndex: 2,
      }}>
        <div style={{ fontSize: 8, letterSpacing: '0.45em', color: 'rgba(0,232,122,0.45)', marginBottom: 4 }}>
          COGNITIVE OBSERVER SYSTEM
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.85)' }}>
          DASHBOARD BOOT SEQUENCE
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity:0; transform:translateX(16px); }
          to   { opacity:1; transform:translateX(0); }
        }
      `}</style>
    </div>
  );
}
