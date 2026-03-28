import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Brain, AlertTriangle, MapPin, Activity, Layers, Zap } from "lucide-react";

const features = [
  {
    icon: Layers,
    title: "Attention Residue Meter",
    description: "Detects when a user has switched tasks but still carries unresolved context from the previous one — the hidden drag that degrades new-task performance.",
  },
  {
    icon: AlertTriangle,
    title: "Pre-Error Sentinel",
    description: "Identifies interaction patterns that frequently precede mistakes, stalls, and cognitive breakdowns — surfacing risk before it becomes visible failure.",
  },
  {
    icon: MapPin,
    title: "Confusion Localization",
    description: "Pinpoints exactly where users get stuck — across pages, tools, and artifacts — by reading hesitation, re-reads, and navigation reversals.",
  },
  {
    icon: Activity,
    title: "Flow Integrity Tracking",
    description: "Distinguishes stable deep-focus windows from fragmented attention states, so interruptions can be timed intelligently rather than arbitrarily.",
  },
  {
    icon: Brain,
    title: "Recovery Capsule",
    description: "Preserves task context at the moment of interruption or overload and surfaces the best next step when the user returns — reducing recovery lag.",
  },
  {
    icon: Zap,
    title: "Productive Struggle Engine",
    description: "Differentiates healthy cognitive effort from harmful confusion, so adaptive support is offered at the right moment rather than too early or too late.",
  },
];

const FeatureCard = ({ feature, index }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const Icon = feature.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="glass-card glow-border-hover p-8 rounded-2xl group cursor-default"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-5 group-hover:bg-primary/25 transition-colors duration-500">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h3 className="font-heading text-lg font-semibold text-foreground mb-3">{feature.title}</h3>
      <p className="font-body text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
    </motion.div>
  );
};

const FeaturesSection = () => {
  return (
    <section id="features" className="section-spacing relative">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-heading text-3xl md:text-5xl font-bold text-foreground mb-4">
            Six Signals. <span className="text-gradient-primary">One Layer.</span>
          </h2>
          <p className="font-body text-muted-foreground text-lg max-w-xl mx-auto">
            Core modules that surface hidden cognitive states from passive interaction patterns.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <FeatureCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
