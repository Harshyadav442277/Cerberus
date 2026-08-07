import { FieldRow, Section } from "@/components/FieldRow";
import { fetchAgent, fetchMandate } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  let agent: Record<string, unknown> | null = null;
  let counters = { rolling_total_24h: 0, hourly_tx_count: 0 };
  let maxTotal = 3;

  try {
    const data = await fetchAgent();
    agent = data.agent;
    counters = data.counters;
    const mandate = await fetchMandate();
    const controls = mandate.mandate.controls as {
      spend_caps?: { rolling_window?: { max_total?: number } };
    };
    maxTotal = controls.spend_caps?.rolling_window?.max_total ?? 3;
  } catch {
    agent = null;
  }

  if (!agent) {
    return (
      <div className="px-6 py-8 text-mute">
        Agent not found. Run <code className="font-mono">npm run db:seed</code>.
      </div>
    );
  }

  const pct = Math.min(100, (counters.rolling_total_24h / maxTotal) * 100);

  return (
    <div className="px-6 py-6">
      <h1 className="text-[18px] font-semibold tracking-tight">Agent</h1>
      <p className="mt-1 text-[12px] text-mute">
        §7.1 identity plus the live counters the Disposition Engine reads.
      </p>

      <div className="mt-6 max-w-3xl">
        <Section title="Identity">
          <FieldRow name="agent_id">
            <span className="font-mono text-[12px]">{String(agent.agent_id)}</span>
          </FieldRow>
          <FieldRow name="display_name">{String(agent.display_name)}</FieldRow>
          <FieldRow name="owner_id">
            <span className="font-mono text-[12px]">{String(agent.owner_id)}</span>
          </FieldRow>
          <FieldRow name="status">{String(agent.status)}</FieldRow>
          <FieldRow name="created_at">
            <span className="font-mono text-[12px]">{String(agent.created_at)}</span>
          </FieldRow>
        </Section>

        <Section title="Live counters">
          <FieldRow name="rolling_total_24h">
            <div>
              <span className="font-mono text-[12px] tabular-nums">
                {counters.rolling_total_24h.toFixed(2)} / {maxTotal.toFixed(2)} USDC
              </span>
              <div className="mt-2 h-1.5 w-64 overflow-hidden rounded-[2px] bg-border">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </FieldRow>
          <FieldRow name="hourly_tx_count">
            <span className="font-mono text-[12px] tabular-nums">
              {counters.hourly_tx_count}
            </span>
          </FieldRow>
        </Section>
      </div>
    </div>
  );
}
