import { FieldRow, Section } from "@/components/FieldRow";
import { fetchMandate } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function MandatePage() {
  let mandate: Record<string, unknown> | null = null;
  try {
    const data = await fetchMandate();
    mandate = data.mandate;
  } catch {
    mandate = null;
  }

  if (!mandate) {
    return (
      <div className="px-6 py-8 text-mute">
        No active mandate. Run <code className="font-mono">npm run db:seed</code>.
      </div>
    );
  }

  const controls = mandate.controls as Record<string, unknown>;
  const scope = mandate.scope as Record<string, unknown>;

  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-3">
        <h1 className="text-[18px] font-semibold tracking-tight">Mandate</h1>
        <span className="rounded-[2px] border border-border bg-chrome px-1.5 py-0.5 font-mono text-[12px]">
          v{String(mandate.version)}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-mute">
        Read-only render of the active §7.2 mandate. Authoring is out of scope.
      </p>

      <div className="mt-6 max-w-3xl">
        <Section title="Metadata">
          <FieldRow name="mandate_id">
            <span className="font-mono text-[12px]">{String(mandate.mandate_id)}</span>
          </FieldRow>
          <FieldRow name="agent_id">
            <span className="font-mono text-[12px]">{String(mandate.agent_id)}</span>
          </FieldRow>
          <FieldRow name="status">{String(mandate.status)}</FieldRow>
          <FieldRow name="effective_from">
            <span className="font-mono text-[12px]">
              {String(mandate.effective_from)}
            </span>
          </FieldRow>
          <FieldRow name="effective_to">
            <span className="font-mono text-[12px]">
              {String(mandate.effective_to ?? "null")}
            </span>
          </FieldRow>
          <FieldRow name="created_by">{String(mandate.created_by)}</FieldRow>
          <FieldRow name="approved_by">{String(mandate.approved_by)}</FieldRow>
        </Section>

        <Section title="Scope">
          <FieldRow name="action_types">
            <span className="font-mono text-[12px]">
              {JSON.stringify(scope.action_types)}
            </span>
          </FieldRow>
          <FieldRow name="currencies">
            <span className="font-mono text-[12px]">
              {JSON.stringify(scope.currencies)}
            </span>
          </FieldRow>
        </Section>

        <Section title="Controls">
          <FieldRow name="spend_caps">
            <pre className="font-mono text-[12px]">
              {JSON.stringify(controls.spend_caps, null, 2)}
            </pre>
          </FieldRow>
          <FieldRow name="counterparty_policy">
            <pre className="font-mono text-[12px]">
              {JSON.stringify(controls.counterparty_policy, null, 2)}
            </pre>
          </FieldRow>
          <FieldRow name="time_window">
            <pre className="font-mono text-[12px]">
              {JSON.stringify(controls.time_window, null, 2)}
            </pre>
          </FieldRow>
          <FieldRow name="velocity">
            <pre className="font-mono text-[12px]">
              {JSON.stringify(controls.velocity, null, 2)}
            </pre>
          </FieldRow>
        </Section>
      </div>
    </div>
  );
}
