import { Clock, Network, ShieldCheck, Sparkles } from "lucide-react";

const METRICS = [
  { icon: Network, label: "8 specialist agents", sub: "Orchestrated evaluation graph" },
  { icon: Clock, label: "< 3 min", sub: "Recording to hiring insight" },
  { icon: ShieldCheck, label: "Evidence-backed", sub: "Every score tied to transcript" },
  { icon: Sparkles, label: "JD-grounded", sub: "Skills rubric from your job description" },
];

export default function DemoHero() {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-card to-accent/10 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Agentic Interview Intelligence</p>
          <h2 className="font-display text-xl font-bold text-heading sm:text-2xl">
            From recording to hiring decision — powered by AI agents
          </h2>
          <p className="text-sm text-muted-foreground">
            Upload a meeting recording or capture live in-browser. InterviewGraph transcribes, evaluates against your JD,
            and delivers structured scores with recruiter-ready feedback.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-2xl">
          {METRICS.map(({ icon: Icon, label, sub }) => (
            <div
              key={label}
              className="rounded-xl border border-border/60 bg-background/40 px-3 py-3 backdrop-blur-sm"
            >
              <Icon className="mb-1.5 size-4 text-accent" aria-hidden />
              <p className="text-sm font-semibold text-heading">{label}</p>
              <p className="text-[0.65rem] leading-snug text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
