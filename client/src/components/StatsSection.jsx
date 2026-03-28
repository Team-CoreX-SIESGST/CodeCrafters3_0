import useCountUp from "@/hooks/useCountUp";

const stats = [
  { end: 87, suffix: "%", label: "Confusion hotspots surfaced" },
  { end: 3, suffix: "×", label: "Faster context recovery" },
  { end: 62, suffix: "%", label: "Risky transitions flagged early" },
  { end: 91, suffix: "%", label: "Pre-error moments identified" },
];

const StatsSection = () => {
  return (
    <section className="py-16 bg-primary">
      <div className="mx-auto max-w-6xl px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((s, i) => (
          <StatItem key={i} {...s} />
        ))}
      </div>
    </section>
  );
};

const StatItem = ({ end, suffix, label }) => {
  const { count, ref } = useCountUp(end);

  return (
    <div ref={ref}>
      <p className="text-4xl md:text-[56px] font-mono text-primary-foreground font-semibold">
        {count}{suffix}
      </p>
      <p className="text-sm text-primary-foreground mt-1" style={{ opacity: 0.85 }}>
        {label}
      </p>
    </div>
  );
};

export default StatsSection;
