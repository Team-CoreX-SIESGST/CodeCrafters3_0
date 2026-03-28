import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Brain, Radar, MessageCircle, TrendingUp, Map, GitBranch } from "lucide-react";

const features = [
  { icon: Brain, title: "AI Future Simulator", description: "Run thousands of simulations on your career trajectory using advanced AI models." },
  { icon: Radar, title: "Skill Gap Radar", description: "Identify missing skills and get personalized learning paths to close the gap." },
  { icon: MessageCircle, title: "Future Self Chat", description: "Have a conversation with your AI-projected future self for guidance." },
  { icon: TrendingUp, title: "Career Trend Dashboard", description: "Track emerging industries and roles with real-time labor market intelligence." },
  { icon: Map, title: "Life GPS Roadmap", description: "Turn your goals into step-by-step actionable milestones with deadlines." },
  { icon: GitBranch, title: "Decision Impact Analyzer", description: "See how each decision branches into different future outcomes." },
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
            Your Future, <span className="text-gradient-primary">Engineered</span>
          </h2>
          <p className="font-body text-muted-foreground text-lg max-w-xl mx-auto">
            Six powerful AI modules working together to map your trajectory.
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
