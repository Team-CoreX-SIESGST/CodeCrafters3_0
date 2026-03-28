import useScrollReveal from "@/hooks/useScrollReveal";

const sessionEpisodes = [
  { label: "Deep Focus", time: "09:14", duration: "38 min", tier: "green" },
  { label: "Attention Residue", time: "09:52", duration: "11 min", tier: "amber" },
  { label: "Confusion Spike", time: "10:03", duration: "6 min", tier: "red" },
  { label: "Recovery", time: "10:09", duration: "4 min", tier: "yellow" },
  { label: "Flow Restored", time: "10:13", duration: "22 min", tier: "green" },
];

const tierColors = {
  red: { bg: "rgba(var(--destructive-rgb),0.15)", text: "var(--destructive)", border: "var(--destructive)" },
  amber: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", border: "#f59e0b" },
  yellow: { bg: "rgba(234,179,8,0.15)", text: "#eab308", border: "#eab308" },
  green: { bg: "rgba(var(--primary-rgb),0.15)", text: "var(--primary)", border: "var(--primary)" },
};

const tracePoints = [
  { x: 20, y: 70 }, { x: 55, y: 55 }, { x: 90, y: 50 }, { x: 125, y: 48 },
  { x: 160, y: 52 }, { x: 185, y: 90 }, { x: 210, y: 115 }, { x: 235, y: 125 },
  { x: 265, y: 118 }, { x: 290, y: 95 }, { x: 320, y: 78 }, { x: 360, y: 65 },
  { x: 400, y: 60 }, { x: 440, y: 58 }, { x: 480, y: 55 },
];

const buildPath = (pts) =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

const DemoPreviewSection = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="demo" className="py-24 md:py-32 bg-background">
      <div
        ref={ref}
        className="mx-auto max-w-6xl px-6"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(24px)",
          transition: "all 0.6s ease",
        }}
      >
        <div className="text-center mb-12">
          <span className="pill-badge">DEMO PREVIEW</span>
          <h2 className="mt-6 text-3xl md:text-[44px] leading-[1.15] font-serif text-foreground">
            See cognitive friction
            <br />
            <span className="font-bold">before it becomes a mistake.</span>
          </h2>
        </div>

        {/* Mock dashboard */}
        <div
          className="mx-auto max-w-[960px] rounded-2xl border border-border overflow-hidden"
          style={{
            background: "hsl(var(--card))",
            boxShadow: "0 32px 80px rgba(var(--primary-rgb),0.08)",
          }}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 h-11 border-b border-border"
            style={{ background: "color-mix(in srgb, var(--card) 88%, transparent)" }}
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
              <span className="text-xs font-serif text-foreground">NeuroTrace</span>
            </div>
            <span className="pill-badge-amber !text-[10px]">⚠ Attention residue · confusion spike detected</span>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-mono text-primary">Observing</span>
            </div>
          </div>

          {/* Three panel layout */}
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_220px] min-h-[420px]">
            {/* Left sidebar — session timeline */}
            <div className="border-r border-border p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Session Timeline
              </p>
              <div className="space-y-2">
                {sessionEpisodes.map((e) => {
                  const c = tierColors[e.tier];
                  return (
                    <div
                      key={e.label}
                      className="flex items-center justify-between rounded-lg p-2 border border-border hover:border-primary/30 transition cursor-pointer"
                      style={{ background: "color-mix(in srgb, var(--secondary) 70%, transparent)" }}
                    >
                      <div>
                        <p className="text-xs text-foreground leading-tight">{e.label}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{e.time} · {e.duration}</p>
                      </div>
                      <span
                        className="text-[10px] font-mono rounded-full px-2 py-0.5 whitespace-nowrap"
                        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                      >
                        {e.tier === "green" ? "✓" : e.tier === "red" ? "!" : "~"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="pill-badge !text-[9px] !px-2 !py-0.5">2 friction episodes</span>
                <span className="pill-badge !text-[9px] !px-2 !py-0.5">Flow restored</span>
              </div>
            </div>

            {/* Center — attention trace graph */}
            <div className="p-4 flex flex-col">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Cognitive Attention Trace
              </p>
              <div className="flex-1 flex items-center justify-center">
                <svg viewBox="0 0 500 160" className="w-full max-h-[200px]">
                  {/* Grid lines */}
                  {[40, 80, 120].map((y) => (
                    <line key={y} x1="10" y1={y} x2="490" y2={y} stroke="var(--border)" strokeWidth="0.5" strokeOpacity="0.6" />
                  ))}
                  {/* State zone fills */}
                  <rect x="10" y="10" width="470" height="30" fill="rgba(var(--primary-rgb),0.04)" />
                  <rect x="10" y="80" width="470" height="40" fill="rgba(245,158,11,0.04)" />
                  <rect x="10" y="110" width="470" height="40" fill="rgba(var(--destructive-rgb),0.04)" />

                  {/* Zone labels */}
                  <text x="14" y="28" fontSize="7" fill="var(--primary)" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.5">DEEP FOCUS</text>
                  <text x="14" y="96" fontSize="7" fill="#f59e0b" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.5">RESIDUE / DRIFT</text>
                  <text x="14" y="138" fontSize="7" fill="var(--destructive)" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.5">CONFUSION / RISK</text>

                  {/* Attention trace line */}
                  <path
                    d={buildPath(tracePoints)}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="1.8"
                    strokeOpacity="0.75"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {/* Area fill under trace */}
                  <path
                    d={`${buildPath(tracePoints)} L 480 160 L 20 160 Z`}
                    fill="rgba(var(--primary-rgb),0.06)"
                  />

                  {/* Confusion spike marker */}
                  <circle cx="210" cy="115" r="5" fill="rgba(var(--destructive-rgb),0.2)" stroke="var(--destructive)" strokeWidth="1">
                    <animate attributeName="r" values="5;9;5" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="stroke-opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <text x="218" y="112" fontSize="7.5" fill="var(--destructive)" fontFamily="'IBM Plex Mono',monospace">confusion spike</text>

                  {/* Recovery marker */}
                  <circle cx="290" cy="95" r="4" fill="rgba(234,179,8,0.2)" stroke="#eab308" strokeWidth="1" />
                  <text x="298" y="92" fontSize="7.5" fill="#eab308" fontFamily="'IBM Plex Mono',monospace">recovery</text>

                  {/* Traveling cursor */}
                  <circle r="3" fill="var(--primary)" fillOpacity="0.9">
                    <animateMotion dur="6s" repeatCount="indefinite" path={buildPath(tracePoints)} />
                  </circle>
                </svg>
              </div>
              <p className="text-xs font-mono text-muted-foreground text-center mt-2">
                Confusion spike at <span className="text-destructive">10:03</span> · recovery lag <span className="text-primary">4 min</span>
              </p>
            </div>

            {/* Right sidebar — state detail + recovery capsule */}
            <div className="border-l border-border p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Active State
              </p>
              <div className="space-y-3">
                <div>
                  <h4 className="text-base font-serif text-foreground">Flow Restored</h4>
                  <p className="text-[11px] font-mono text-muted-foreground">Session · 10:13 onwards</p>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1">
                  <p>Focus depth: <span className="text-foreground">High</span></p>
                  <p>Confusion risk: <span className="text-foreground">Low</span></p>
                  <p>Residue load: <span className="text-foreground">Clearing</span></p>
                  <p>Interruptibility: <span className="text-foreground">Low</span></p>
                </div>
                <div>
                  <span className="text-3xl font-mono text-primary font-semibold">82</span>
                  <span className="text-sm text-muted-foreground font-mono"> /100 focus</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="pill-badge !text-[9px] !px-2 !py-0.5">Confusion resolved</span>
                  <span className="pill-badge-amber !text-[9px] !px-2 !py-0.5">Residue fading</span>
                </div>
                <div
                  className="rounded-lg border border-border p-2 mt-1"
                  style={{ background: "color-mix(in srgb, var(--secondary) 60%, transparent)" }}
                >
                  <p className="text-[9px] font-mono text-primary mb-1 uppercase tracking-wider">Recovery Capsule</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">Context saved at 10:09. Suggested re-entry: resume from line 47 of the open document.</p>
                </div>
                <button
                  className="w-full mt-1 rounded-lg border border-primary text-primary text-xs font-mono py-2 hover:bg-primary/10 transition"
                >
                  Explore Full Session ↗
                </button>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center mt-8">
          <a href="#" className="text-[15px] text-primary hover:underline">
            View the full interactive demo →
          </a>
        </p>
      </div>
    </section>
  );
};

export default DemoPreviewSection;
