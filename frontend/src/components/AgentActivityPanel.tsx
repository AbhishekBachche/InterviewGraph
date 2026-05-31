import { AGENTS_FULL, AGENTS_SUMMARY, type AgentStatus } from "./AgentActivityPanel.types";

export { AGENTS_FULL, AGENTS_SUMMARY, type AgentStatus } from "./AgentActivityPanel.types";

type AgentActivityPanelProps = {
  active: boolean;
  mode: "full" | "summary";
  agentStatus?: Record<string, AgentStatus>;
  className?: string;
};

export default function AgentActivityPanel({
  active,
  mode,
  agentStatus,
}: AgentActivityPanelProps) {
  const agents = mode === "full" ? AGENTS_FULL : AGENTS_SUMMARY;
  const useLive = Boolean(agentStatus && Object.keys(agentStatus).length > 0);

  if (!active && !useLive) return null;

  const allComplete = useLive
    ? agents.every((a) => agentStatus![a.id] === "complete")
    : !active;

  return (
    <section className="ig-agents" role="status" aria-live="polite" aria-label="Agent activity">
      <div className="ig-agents__head">
        <div className="ig-agents__icon" aria-hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V11h3a3 3 0 0 1 3 3v1h1a2 2 0 0 1 2 2v2H5v-2a2 2 0 0 1 2-2h1v-1a3 3 0 0 1 3-3h3V9.5A4 4 0 0 1 12 2z" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <p className="ig-agents__title">Multi-Agent Pipeline</p>
          <p className="ig-agents__sub">
            {active
              ? "Agents working…"
              : allComplete
                ? "All agents complete"
                : "Ready"}
          </p>
        </div>
        {active && (
          <div
            style={{
              width: 20,
              height: 20,
              border: "2px solid hsl(var(--primary) / 0.3)",
              borderTopColor: "hsl(var(--primary))",
              borderRadius: "50%",
              animation: "ig-spin 0.8s linear infinite",
            }}
            aria-hidden
          />
        )}
      </div>

      <ul className="ig-agents__list">
        {agents.map((agent) => {
          const status: AgentStatus = useLive
            ? agentStatus![agent.id] || "pending"
            : active
              ? "pending"
              : "complete";

          return (
            <li
              key={agent.id}
              className={`ig-agent ig-agent--${status}`}
            >
              <span className="ig-agent__dot" aria-hidden />
              <div>
                <p className="ig-agent__label">{agent.label}</p>
                {(status === "running" || status === "complete") && (
                  <p className="ig-agent__hint">{agent.description}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
