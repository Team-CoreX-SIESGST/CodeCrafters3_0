import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Send, Bot, User } from "lucide-react";

const messages = [
  { role: "user", text: "Should I learn AI or cybersecurity?" },
  { role: "ai", text: "By 2035, AI security became one of the most critical fields. The intersection of both disciplines creates the highest-value career trajectories. I'd recommend starting with AI fundamentals, then specializing in adversarial ML and AI safety." },
];

const ChatbotPreview = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section id="chat-with-future-self" className="relative min-h-[700px] flex items-center overflow-hidden" ref={ref}>
      {/* Video background */}
      <div className="absolute inset-0 z-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover opacity-30"
        >
          <source src="/videos/chatbot_bg.webm" type="video/webm" />
        </video>
        <div className="absolute inset-0 bg-background/70" />
      </div>

      <div className="relative z-10 container mx-auto px-6 py-24">
        <div className="text-center mb-12">
          <h2 className="font-heading text-3xl md:text-5xl font-bold text-foreground mb-4">
            Chat with Your <span className="text-gradient-primary">Future Self</span>
          </h2>
          <p className="font-body text-muted-foreground text-lg max-w-xl mx-auto">
            Ask your AI-projected future self for career advice and life decisions.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="max-w-2xl mx-auto glass-card glow-border rounded-2xl p-6 md:p-8"
        >
          {/* Chat messages */}
          <div className="space-y-5 mb-6">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: msg.role === "user" ? 20 : -20 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.3 + i * 0.3 }}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "ai" && (
                  <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm font-body leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary/20 text-foreground rounded-br-md"
                    : "bg-surface-3 text-muted-foreground rounded-bl-md"
                }`}>
                  {msg.text}
                </div>
                {msg.role === "user" && (
                  <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center shrink-0 mt-1">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>

          {/* Input */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : {}}
            transition={{ duration: 0.5, delay: 1 }}
            className="flex items-center gap-3 p-3 rounded-xl bg-surface-3/50 border border-border/30 animate-pulse-glow"
          >
            <input
              type="text"
              placeholder="Ask your future self anything..."
              className="flex-1 bg-transparent text-sm font-body text-foreground placeholder:text-muted-foreground outline-none"
              readOnly
            />
            <button className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Send className="w-4 h-4 text-primary-foreground" />
            </button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default ChatbotPreview;
