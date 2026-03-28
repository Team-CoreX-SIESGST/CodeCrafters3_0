import useScrollReveal from "@/hooks/useScrollReveal";

const steps = [
  {
    num: "01",
    title: "Observe",
    subtitle: "Passive behavioral signal collection",
    body: "Typing rhythm, task-switching patterns, hesitation timing, dwell duration, mouse movement, navigation reversals, and interaction pacing are captured passively — no manual input required.",
  },
  {
    num: "02",
    title: "Infer",
    subtitle: "Derive cognitive state indicators",
    body: "Signals are mapped to indicators including focus depth, confusion risk, fatigue drift, attention residue load, and interruptibility score — forming a continuous cognitive state model.",
  },
  {
    num: "03",
    title: "Predict",
    subtitle: "Detect rising risk before failure",
    body: "Pattern matching identifies pre-error signatures, overload trajectories, and transition friction before they become visible — giving the system time to act before a mistake occurs.",
  },
  {
    num: "04",
    title: "Assist",
    subtitle: "Timely recovery and friction relief",
    body: "Recovery Capsules preserve context at interruption points. Interruption deferral suggests better timing. Explainable state feedback helps users understand and course-correct their cognitive load.",
  },
];

const CognitiveSignalDiagram = () => (
  <svg viewBox="0 0 240 200" width="100%" height="100%" style={{ display: "block" }}>
    <defs>
      <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
        <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* Connecting arcs */}
    <path d="M 60 100 Q 120 40 180 100" fill="none" stroke="var(--primary)" strokeWidth="0.8" strokeOpacity="0.25" strokeDasharray="4 3" />
    <path d="M 60 100 Q 120 160 180 100" fill="none" stroke="var(--primary)" strokeWidth="0.8" strokeOpacity="0.18" strokeDasharray="4 3" />
    <line x1="60" y1="100" x2="180" y2="100" stroke="var(--primary)" strokeWidth="0.6" strokeOpacity="0.15" />

    {/* Animated signal pulse */}
    <circle r="3" fill="var(--primary)" fillOpacity="0.9">
      <animateMotion dur="2.8s" repeatCount="indefinite" path="M 60 100 Q 120 40 180 100" />
    </circle>
    <circle r="2.2" fill="var(--primary)" fillOpacity="0.7">
      <animateMotion dur="3.4s" repeatCount="indefinite" begin="1.1s" path="M 180 100 Q 120 160 60 100" />
    </circle>

    {/* Node: Observe */}
    <circle cx="60" cy="100" r="22" fill="url(#nodeGlow)" />
    <circle cx="60" cy="100" r="14" fill="none" stroke="var(--primary)" strokeWidth="1.2" strokeOpacity="0.6" />
    <circle cx="60" cy="100" r="5" fill="var(--primary)" fillOpacity="0.85">
      <animate attributeName="r" values="5;7;5" dur="2.2s" repeatCount="indefinite" />
      <animate attributeName="fill-opacity" values="0.85;0.5;0.85" dur="2.2s" repeatCount="indefinite" />
    </circle>
    <text x="60" y="126" textAnchor="middle" fontSize="8" fill="var(--primary)" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.75">OBSERVE</text>

    {/* Node: Infer */}
    <circle cx="180" cy="100" r="22" fill="url(#nodeGlow)" />
    <circle cx="180" cy="100" r="14" fill="none" stroke="var(--primary)" strokeWidth="1.2" strokeOpacity="0.6" />
    <circle cx="180" cy="100" r="5" fill="var(--primary)" fillOpacity="0.85">
      <animate attributeName="r" values="5;7;5" dur="2.6s" repeatCount="indefinite" begin="0.8s" />
      <animate attributeName="fill-opacity" values="0.85;0.5;0.85" dur="2.6s" repeatCount="indefinite" begin="0.8s" />
    </circle>
    <text x="180" y="126" textAnchor="middle" fontSize="8" fill="var(--primary)" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.75">INFER</text>

    {/* Node: State (center top) */}
    <circle cx="120" cy="52" r="16" fill="none" stroke="var(--primary)" strokeWidth="1" strokeOpacity="0.45" />
    <circle cx="120" cy="52" r="5" fill="var(--primary)" fillOpacity="0.6">
      <animate attributeName="r" values="5;8;5" dur="3s" repeatCount="indefinite" begin="0.4s" />
      <animate attributeName="fill-opacity" values="0.6;0.25;0.6" dur="3s" repeatCount="indefinite" begin="0.4s" />
    </circle>
    <text x="120" y="38" textAnchor="middle" fontSize="7.5" fill="var(--primary)" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.6">PREDICT</text>

    {/* Node: Assist (center bottom) */}
    <circle cx="120" cy="150" r="16" fill="none" stroke="var(--primary)" strokeWidth="1" strokeOpacity="0.45" />
    <circle cx="120" cy="150" r="5" fill="var(--primary)" fillOpacity="0.6">
      <animate attributeName="r" values="5;8;5" dur="2.8s" repeatCount="indefinite" begin="1.6s" />
      <animate attributeName="fill-opacity" values="0.6;0.25;0.6" dur="2.8s" repeatCount="indefinite" begin="1.6s" />
    </circle>
    <text x="120" y="175" textAnchor="middle" fontSize="7.5" fill="var(--primary)" fontFamily="'IBM Plex Mono',monospace" fillOpacity="0.6">ASSIST</text>

    {/* Vertical connections */}
    <line x1="60" y1="86" x2="108" y2="62" stroke="var(--primary)" strokeWidth="0.6" strokeOpacity="0.2" strokeDasharray="3 3" />
    <line x1="180" y1="86" x2="132" y2="62" stroke="var(--primary)" strokeWidth="0.6" strokeOpacity="0.2" strokeDasharray="3 3" />
    <line x1="60" y1="114" x2="108" y2="140" stroke="var(--primary)" strokeWidth="0.6" strokeOpacity="0.2" strokeDasharray="3 3" />
    <line x1="180" y1="114" x2="132" y2="140" stroke="var(--primary)" strokeWidth="0.6" strokeOpacity="0.2" strokeDasharray="3 3" />
  </svg>
);

const HowItWorksSection = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      id="how-it-works"
      className="py-24 md:py-32 bg-secondary"
    >
      <div
        ref={ref}
        className="mx-auto max-w-6xl px-6"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(24px)",
          transition: "all 0.6s ease",
        }}
      >
        {/* Header row: text left, diagram right */}
        <div className="grid md:grid-cols-2 gap-12 items-center mb-14">
          <div>
            <span className="text-8xl font-mono text-primary text-bold mb-2">HOW IT WORKS</span>
            <h2 className="mt-6 text-3xl md:text-[42px] leading-[1.15] font-serif text-foreground">
              From interaction patterns
              <br />
              <span className="font-bold">to explainable cognitive state.</span>
            </h2>
          </div>
          <div className="flex justify-center md:justify-end">
            <div className="float-card animate-idle-float p-5 w-full max-w-[280px]" style={{ height: 220 }}>
              <CognitiveSignalDiagram />
            </div>
          </div>
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((s, i) => (
            <div
              key={s.num}
              className="glass-card !p-5 flex flex-col"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <span className="text-2xl font-mono text-primary mb-2" style={{ opacity: 0.3 }}>
                {s.num}
              </span>
              <h3 className="text-base font-serif text-foreground">
                {s.title}
              </h3>
              <p className="text-xs font-mono text-primary mb-2">{s.subtitle}</p>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
