import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { ArrowRight } from "lucide-react";

const CTASection = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="section-spacing relative" ref={ref}>
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={isInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.7 }}
          className="relative max-w-3xl mx-auto text-center p-12 md:p-20 rounded-3xl glass-card glow-border overflow-hidden"
        >
          {/* Background glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 bg-primary/20 rounded-full blur-[100px]" />

          <h2 className="relative font-heading text-3xl md:text-5xl font-bold text-foreground mb-4">
            Start Designing Your
            <br />
            <span className="text-gradient-primary">Future Today</span>
          </h2>

          <p className="relative font-body text-muted-foreground text-lg mb-8 max-w-md mx-auto">
            Join thousands of forward-thinkers already planning toward 2035.
          </p>

          <button className="relative group px-10 py-4 bg-primary rounded-xl font-heading font-semibold text-primary-foreground btn-glow transition-all duration-300 inline-flex items-center gap-2">
            Start Your Journey
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
