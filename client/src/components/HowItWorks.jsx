import useScrollReveal from "@/hooks/useScrollReveal";
import CircularFlowDiagram from "./CircularFlowDiagram";

const steps = [
  {
    num: "01",
    title: "Ingest",
    subtitle: "Load transaction & ownership data",
    body: "Bank transfer records, corporate registry filings, and beneficial ownership declarations are ingested. Public offshore datasets (ICIJ Offshore Leaks, FinCEN Files) are cross-referenced automatically.",
  },
  {
    num: "02",
    title: "Graph",
    subtitle: "Build the entity relationship graph",
    body: "Every company, individual, and account becomes a node. Every fund transfer, loan, or invoice becomes a directed edge. Multi-hop chains spanning 6+ jurisdictions are resolved into a single traversable graph.",
  },
  {
    num: "03",
    title: "Detect",
    subtitle: "Run circular flow & typology analysis",
    body: "Graph algorithms scan for closed loops, shared UBOs, bridge nodes, and structural anomalies matching 28 known laundering typologies.",
  },
  {
    num: "04",
    title: "Score",
    subtitle: "Assign risk scores 0–100",
    body: "Each entity and sub-network receives a risk score based on loop participation, jurisdictional risk, transaction velocity, and typology matches. Critical flags (90+) are escalated immediately.",
  },
  {
    num: "05",
    title: "Investigate",
    subtitle: "Surface evidence to the dashboard",
    body: "Flagged networks appear in the investigator queue with visual ownership chains, fund movement timelines, typology tags, and exportable evidence packages.",
  },
];

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
              From raw data to
              <br />
              <span className="font-bold">a complete network picture.</span>
            </h2>
          </div>
          <div className="flex justify-center md:justify-end">
            <div className="float-card animate-idle-float p-5 w-full max-w-[280px]">
              <CircularFlowDiagram />
            </div>
          </div>
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
