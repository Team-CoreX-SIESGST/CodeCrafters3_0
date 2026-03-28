import useScrollReveal from "@/hooks/useScrollReveal";

const entities = [
  { name: "Nexus Holdings Ltd", jurisdiction: "BVI", score: 94, tier: "red"  },
  { name: "Meridian Trust Co", jurisdiction: "Cayman", score: 81, tier: "amber"  },
  { name: "Albatross LLC", jurisdiction: "Panama", score: 76, tier: "amber"  },
  { name: "Pacific Ventures", jurisdiction: "Delaware", score: 52, tier: "yellow"  },
  { name: "Coral Bay Corp", jurisdiction: "Cyprus", score: 38, tier: "green"  },
];

const tierColors = {
  red: { bg: "rgba(var(--destructive-rgb),0.15)", text: "var(--destructive)", border: "var(--destructive)" },
  amber: { bg: "rgba(245,158,11,0.15)", text: "#f59e0b", border: "#f59e0b" },
  yellow: { bg: "rgba(234,179,8,0.15)", text: "#eab308", border: "#eab308" },
  green: { bg: "rgba(var(--primary-rgb),0.15)", text: "var(--primary)", border: "var(--primary)" },
};

const graphNodes = [
  { id: "NH", x: 200, y: 60, flagged: true },
  { id: "MT", x: 340, y: 100, flagged: true },
  { id: "AL", x: 310, y: 220, flagged: true },
  { id: "PV", x: 150, y: 240, flagged: false },
  { id: "CB", x: 80, y: 140, flagged: false },
  { id: "X1", x: 420, y: 180, flagged: false },
  { id: "X2", x: 260, y: 160, flagged: false },
  { id: "X3", x: 120, y: 40, flagged: false },
  { id: "X4", x: 380, y: 40, flagged: false },
];

const graphEdges = [
  { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 0, isLoop: true },
  { from: 0, to: 7 }, { from: 1, to: 5 }, { from: 2, to: 3 },
  { from: 3, to: 4 }, { from: 4, to: 0 }, { from: 1, to: 8 },
  { from: 6, to: 2 }, { from: 6, to: 1 },
];

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
            See a suspicious network
            <br />
            <span className="font-bold">caught in real time.</span>
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
              <span className="text-xs font-serif text-foreground">AML Shield</span>
            </div>
            <span className="pill-badge-amber !text-[10px]">⚠ 3 suspicious networks detected</span>
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-mono text-primary">Live</span>
            </div>
          </div>

          {/* Three panel layout */}
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_220px] min-h-[420px]">
            {/* Left sidebar */}
            <div className="border-r border-border p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Flagged Entities
              </p>
              <div className="space-y-2">
                {entities.map((e) => {
                  const c = tierColors[e.tier];
                  return (
                    <div
                      key={e.name}
                      className="flex items-center justify-between rounded-lg p-2 border border-border hover:border-primary/30 transition cursor-pointer"
                      style={{ background: "color-mix(in srgb, var(--secondary) 70%, transparent)" }}
                    >
                      <div>
                        <p className="text-xs text-foreground leading-tight">{e.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{e.jurisdiction}</p>
                      </div>
                      <span
                        className="text-[10px] font-mono rounded-full px-2 py-0.5"
                        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
                      >
                        {e.score}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="pill-badge !text-[9px] !px-2 !py-0.5">Circular flow · 3 entities</span>
                <span className="pill-badge !text-[9px] !px-2 !py-0.5">Loan-back · 2 entities</span>
              </div>
            </div>

            {/* Center graph */}
            <div className="p-4 flex flex-col">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                Network Graph
              </p>
              <div className="flex-1 flex items-center justify-center">
                <svg viewBox="0 0 500 280" className="w-full max-h-[280px]">
                  {graphEdges.map((edge, i) => {
                    const from = graphNodes[edge.from];
                    const to = graphNodes[edge.to];
                    return (
                      <line
                        key={i}
                        x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                        stroke={edge.isLoop ? "var(--destructive)" : "var(--muted-foreground)"}
                        strokeWidth={edge.isLoop ? 2 : 1}
                        strokeDasharray={edge.isLoop ? "6 3" : undefined}
                        strokeOpacity={edge.isLoop ? 1 : 0.25}
                      />
                    );
                  })}
                  {graphNodes.map((node, i) => (
                    <g key={i}>
                      {node.flagged && (
                        <circle cx={node.x} cy={node.y} r="18" fill="none" stroke="var(--destructive)" strokeWidth="1" opacity="0.3">
                          <animate attributeName="r" values="18;24;18" dur="2s" repeatCount="indefinite" />
                          <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                        </circle>
                      )}
                      <circle
                        cx={node.x} cy={node.y} r="14"
                        fill={node.flagged ? "rgba(var(--destructive-rgb),0.2)" : "var(--card)"}
                        stroke={node.flagged ? "var(--destructive)" : "var(--border)"}
                        strokeWidth="1"
                      />
                      <text
                        x={node.x} y={node.y + 1}
                        fill="var(--foreground)" fontSize="9" textAnchor="middle" dominantBaseline="middle"
                        fontFamily="'IBM Plex Mono', monospace" fontWeight="600"
                      >
                        {node.id}
                      </text>
                    </g>
                  ))}
                  {/* Traveling dots on a couple of edges */}
                  <circle r="3" fill="var(--primary)">
                    <animate attributeName="cx" values={`${graphNodes[0].x};${graphNodes[1].x}`} dur="2s" repeatCount="indefinite" />
                    <animate attributeName="cy" values={`${graphNodes[0].y};${graphNodes[1].y}`} dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle r="3" fill="var(--primary)">
                    <animate attributeName="cx" values={`${graphNodes[1].x};${graphNodes[2].x}`} dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="cy" values={`${graphNodes[1].y};${graphNodes[2].y}`} dur="2.5s" repeatCount="indefinite" />
                  </circle>
                </svg>
              </div>
              <p className="text-xs font-mono text-muted-foreground text-center mt-2">
                Loop detected: <span className="text-destructive">$6.8M</span> cycled across 3 hops
              </p>
            </div>

            {/* Right sidebar */}
            <div className="border-l border-border p-4">
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                Entity Detail
              </p>
              <div className="space-y-3">
                <div>
                  <h4 className="text-base font-serif text-foreground">Nexus Holdings Ltd</h4>
                  <p className="text-[11px] font-mono text-muted-foreground">BVI · Incorporated: 2019</p>
                </div>
                <div className="text-[11px] text-muted-foreground space-y-1">
                  <p>UBO: <span className="text-foreground">[Redacted]</span> · Shared with: 3 entities</p>
                  <p>Connected entities: 6 · Transactions: 142</p>
                </div>
                <div>
                  <span className="text-3xl font-mono text-destructive font-semibold">94</span>
                  <span className="text-sm text-muted-foreground font-mono"> /100</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="pill-badge-red !text-[9px] !px-2 !py-0.5">Circular fund flow — Layering</span>
                  <span className="pill-badge-amber !text-[9px] !px-2 !py-0.5">Loan-back scheme</span>
                </div>
                <button
                  className="w-full mt-2 rounded-lg border border-primary text-primary text-xs font-mono py-2 hover:bg-primary/10 transition"
                >
                  Export Evidence Package ↗
                </button>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center mt-8">
          <a href="#" className="text-[15px] text-primary hover:underline">
            Explore the full interactive demo →
          </a>
        </p>
      </div>
    </section>
  );
};

export default DemoPreviewSection;
