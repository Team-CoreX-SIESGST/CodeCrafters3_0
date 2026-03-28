import useScrollReveal from "@/hooks/useScrollReveal";

const blindSpots = [
  { signal: "Cognitively overloaded", status: "invisible" },
  { signal: "Confused but still active", status: "invisible" },
  { signal: "Carrying attention residue", status: "invisible" },
  { signal: "Drifting toward a mistake", status: "invisible" },
];

const ProblemSection = () => {
  const { ref: sectionRef, isVisible: sectionVisible } = useScrollReveal();
  const { ref: cardRef, isVisible: cardVisible } = useScrollReveal();

  return (
    <section
      id="problem"
      className="py-24 md:py-32 bg-secondary"
    >
      <div
        ref={sectionRef}
        className="mx-auto max-w-6xl px-6 grid md:grid-cols-2 gap-12 items-center"
        style={{
          opacity: sectionVisible ? 1 : 0,
          transform: sectionVisible ? "translateY(0)" : "translateY(24px)",
          transition: "all 0.6s ease",
        }}
      >
        {/* Left text */}
        <div>
          <span className="text-8xl font-mono text-primary text-bold mb-2">
            THE PROBLEM
          </span>
          <h2 className="mt-6 text-3xl md:text-[42px] leading-[1.15] text-foreground font-serif">
            Every session looks productive.
            <br />
            <span className="font-bold">Until the mistake appears.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-[1.8] text-muted-foreground max-w-md">
            Digital tools track clicks, sessions, and task completion. But they
            have no visibility into what is happening cognitively — whether a
            user is overloaded, carrying unresolved context, or quietly drifting
            toward a preventable error. Most systems optimize visible
            productivity while remaining completely blind to hidden cognitive
            state.
          </p>
          <a
            href="#how-it-works"
            className="mt-6 inline-block text-sm text-primary hover:underline"
          >
            See how inference works →
          </a>
        </div>

        {/* Right floating card */}
        <div
          className="flex justify-center md:justify-end"
          ref={cardRef}
          style={{
            opacity: cardVisible ? 1 : 0,
            transform: cardVisible ? "translateX(0)" : "translateX(28px)",
            transition: "opacity 0.6s ease, transform 0.6s ease",
          }}
        >
          <div className="float-card animate-idle-float p-6 w-full max-w-sm" style={{ transform: "rotate(-2deg)" }}>
            <span className="pill-badge mb-4">⚠ COGNITIVE BLIND SPOT</span>
            <h3 className="mt-4 text-xl font-serif text-foreground">
              Current Tools Cannot See
            </h3>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Hidden states active during this session
            </p>
            <p className="mt-4 text-4xl font-mono text-destructive font-semibold">
              4 <span className="text-lg text-muted-foreground font-normal">states undetected</span>
            </p>

            <div className="mt-6 space-y-0">
              {blindSpots.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 border-b border-border text-sm"
                >
                  <span className="text-foreground">
                    {row.signal}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {row.status}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <span className="pill-badge-red">Passive signals · not yet surfaced</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProblemSection;
