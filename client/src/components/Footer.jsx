const FooterCTA = () => {
  return (
    <section id="about" className="py-24 md:py-32 bg-background">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl md:text-[44px] leading-[1.15] font-serif text-foreground">
          Understand cognitive friction
          <br />
          <span className="font-bold">before it escalates.</span>
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          NeuroTrace — cognitive observability for digital work.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <a href="#demo" className="btn-primary animate-glow-pulse">
            See It in Action ↗
          </a>
          <a
            href="#how-it-works"
            style={{
              fontSize: 13,
              fontWeight: 500,
              padding: "13px 22px",
              borderRadius: 8,
              textDecoration: "none",
              border: "1px solid rgba(var(--primary-rgb),.2)",
              color: "var(--muted-foreground)",
              transition: "all .2s ease",
            }}
          >
            How it works
          </a>
        </div>
      </div>

      {/* Footer bar */}
      <div className="mt-24 border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground font-mono">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="font-serif text-foreground text-sm">NeuroTrace</span>
          </div>
          <p>© 2025 · Cognitive Observability for Digital Work</p>
          <a href="#" className="text-primary hover:underline">GitHub ↗</a>
        </div>
      </div>
    </section>
  );
};

export default FooterCTA;
