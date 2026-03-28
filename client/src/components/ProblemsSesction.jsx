import useScrollReveal from "@/hooks/useScrollReveal";

const txRows = [
  { from: "Shell Co. A", to: "Shell Co. B", amount: "$2.4M" },
  { from: "Shell Co. B", to: "Shell Co. C", amount: "$2.1M" },
  { from: "Shell Co. C", to: "Shell Co. A", amount: "$2.3M" },
];

const ProblemSection = () => {
  const { ref: sectionRef, isVisible: sectionVisible } = useScrollReveal();
  const { ref: cardRef, isVisible: cardVisible } = useScrollReveal();

  return (
    <section
      id="about"
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
            Every transaction looks clean.
            <br />
            <span className="font-bold">Until you see the pattern.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-[1.8] text-muted-foreground max-w-md">
            Modern money laundering routes funds through chains of
            legitimate-looking shell companies — consulting fees, loan
            repayments, service invoices. Each transfer appears routine in
            isolation. Only the network reveals the truth.
          </p>
          <a
            href="#how-it-works"
            className="mt-6 inline-block text-sm text-primary hover:underline"
          >
            See how detection works →
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
            <span className="pill-badge mb-4">⚠ NETWORK FLAGGED</span>
            <h3 className="mt-4 text-xl font-serif text-foreground">
              Nexus Holdings Ltd
            </h3>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Circular fund flow detected
            </p>
            <p className="mt-4 text-4xl font-mono text-destructive font-semibold">
              94 <span className="text-lg text-muted-foreground font-normal">/ 100</span>
            </p>

            <div className="mt-6 space-y-0">
              {txRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 border-b border-border text-sm"
                >
                  <span className="text-foreground">
                    {row.from} → {row.to}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {row.amount}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <span className="pill-badge-red">Circular flow · 3 hops</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProblemSection;
