import { cn } from "@/lib/utils";

type LogoProps = {
  variant?: "full" | "compact";
  className?: string;
};

function GraphMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="1" y="1" width="38" height="38" rx="10" fill="#0b1220" />
      <rect x="1.5" y="1.5" width="37" height="37" rx="9.5" stroke="url(#ig-border)" strokeWidth="1" />
      <circle cx="10" cy="30" r="3" fill="#7c3aed" />
      <circle cx="20" cy="20" r="3.5" fill="#06b6d4" />
      <circle cx="30" cy="10" r="3" fill="#a78bfa" />
      <path d="M10 30L20 20M20 20L30 10" stroke="#7c3aed" strokeWidth="1.5" strokeOpacity="0.5" />
      <defs>
        <linearGradient id="ig-border" x1="0" y1="0" x2="40" y2="40">
          <stop stopColor="#7c3aed" stopOpacity="0.6" />
          <stop offset="1" stopColor="#06b6d4" stopOpacity="0.4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function InterviewGraphWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={cn("flex flex-col leading-none", className)} aria-label="InterviewGraph">
      <span className="font-display text-lg font-bold tracking-tight text-heading">
        Interview<span className="text-primary">Graph</span>
      </span>
      <span className="mt-0.5 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Agentic AI
      </span>
    </div>
  );
}

/** @deprecated use InterviewGraphWordmark */
export function HireEazeWordmark(props: { className?: string }) {
  return <InterviewGraphWordmark className={props.className} />;
}

export function Logo({ variant = "full", className = "" }: LogoProps) {
  const size = variant === "full" ? 44 : 36;

  if (variant === "compact") {
    return (
      <div className={cn("logo-root logo-root--compact flex items-center", className)} aria-label="InterviewGraph">
        <GraphMark size={size} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "logo-root logo-root--full flex items-center gap-3 rounded-xl border border-border/80 bg-card/60 p-3",
        className
      )}
      aria-label="InterviewGraph"
    >
      <GraphMark size={size} />
      <InterviewGraphWordmark />
    </div>
  );
}
