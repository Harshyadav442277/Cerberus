import Link from "next/link";
import { DispositionBadge } from "@/components/DispositionBadge";
import { FieldRow, Section } from "@/components/FieldRow";
import { explorerTx, fetchAudit, shortHash } from "@/lib/api";
import { thresholdVsActual } from "@/lib/threshold";

export const dynamic = "force-dynamic";

export default async function AuditDrillDownPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const { auditId } = await params;
  let data: Awaited<ReturnType<typeof fetchAudit>> | null = null;
  let error: string | null = null;
  try {
    data = await fetchAudit(auditId);
  } catch (e) {
    error = (e as Error).message;
  }

  if (!data) {
    return (
      <div className="px-6 py-8">
        <Link href="/" className="text-[13px] text-accent hover:underline">
          ← Audit Log
        </Link>
        <p className="mt-4 text-mute">Record not found ({error}).</p>
      </div>
    );
  }

  const { record, action, anchor, mandate } = data;
  const comparison = thresholdVsActual(
    record.rule_triggered,
    mandate as {
      scope?: { action_types?: string[]; currencies?: string[] };
      controls?: Record<string, unknown>;
    } | null,
    action?.payload ?? null,
  );

  return (
    <div className="px-6 py-6">
      <Link href="/" className="text-[13px] text-accent hover:underline">
        ← Audit Log
      </Link>
      <h1 className="mt-3 text-[18px] font-semibold tracking-tight">
        Audit record{" "}
        <span className="font-mono text-[15px] font-normal text-mute">
          {record.audit_id}
        </span>
      </h1>
      <p className="mt-1 text-[12px] text-mute">
        Near-direct render of the Bible §7.5 object — not a redesign of it.
      </p>

      <div className="mt-6 max-w-3xl">
        <Section title="Decision">
          <FieldRow name="audit_id">
            <span className="font-mono text-[12px]">{record.audit_id}</span>
          </FieldRow>
          <FieldRow name="action_id">
            <span className="font-mono text-[12px]">{record.action_id}</span>
          </FieldRow>
          <FieldRow name="disposition">
            <DispositionBadge disposition={record.disposition} />
          </FieldRow>
          <FieldRow name="reason">
            <span className="font-mono text-[12px]">{record.reason}</span>
          </FieldRow>
          <FieldRow name="rule_triggered">
            <span className="font-mono text-[12px]">
              {record.rule_triggered ?? "null"}
            </span>
          </FieldRow>
          <FieldRow name="evaluated_at">
            <span className="font-mono text-[12px]">{record.evaluated_at}</span>
          </FieldRow>
        </Section>

        <Section title="Proposal">
          {action ? (
            <>
              <FieldRow name="counterparty">
                <span className="font-mono text-[12px]">
                  {action.payload.counterparty}
                </span>
              </FieldRow>
              <FieldRow name="amount">
                <span className="font-mono text-[12px] tabular-nums">
                  {action.payload.amount} {action.payload.currency}
                </span>
              </FieldRow>
              <FieldRow name="purpose">{action.payload.purpose}</FieldRow>
              <FieldRow name="reference">
                <span className="font-mono text-[12px]">
                  {action.payload.reference}
                </span>
              </FieldRow>
              <FieldRow name="proposed_at">
                <span className="font-mono text-[12px]">{action.proposed_at}</span>
              </FieldRow>
            </>
          ) : (
            <FieldRow name="action">missing</FieldRow>
          )}
        </Section>

        <Section title="Mandate at decision time">
          <FieldRow name="mandate_id">
            <span className="font-mono text-[12px]">{record.mandate_id}</span>
          </FieldRow>
          <FieldRow name="mandate_version">
            <span className="rounded-[2px] border border-border bg-chrome px-1.5 py-0.5 font-mono text-[12px]">
              v{record.mandate_version}
            </span>
          </FieldRow>
          {comparison ? (
            <>
              <FieldRow name="control_evaluated">
                <span className="font-mono text-[12px]">{comparison.control}</span>
              </FieldRow>
              <FieldRow name="threshold">
                <span className="font-mono text-[12px]">{comparison.threshold}</span>
              </FieldRow>
              <FieldRow name="actual">
                <span className="font-mono text-[12px]">{comparison.actual}</span>
              </FieldRow>
            </>
          ) : (
            <FieldRow name="control_evaluated">
              <span className="text-faint">none — clean ALLOW</span>
            </FieldRow>
          )}
        </Section>

        <Section title="Human Review">
          {record.human_review ? (
            <>
              <FieldRow name="reviewer_id">
                <span className="font-mono text-[12px]">
                  {record.human_review.reviewer_id}
                </span>
              </FieldRow>
              <FieldRow name="decision">{record.human_review.decision}</FieldRow>
              <FieldRow name="decided_at">
                <span className="font-mono text-[12px]">
                  {record.human_review.decided_at}
                </span>
              </FieldRow>
              <FieldRow name="note">{record.human_review.note}</FieldRow>
            </>
          ) : (
            <FieldRow name="human_review">None</FieldRow>
          )}
        </Section>

        <Section title="Settlement">
          {record.settlement ? (
            <>
              <FieldRow name="status">{record.settlement.status}</FieldRow>
              <FieldRow name="tx_hash">
                {record.settlement.tx_hash ? (
                  <a
                    href={explorerTx(record.settlement.tx_hash)}
                    className="font-mono text-[12px] text-accent hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {record.settlement.tx_hash}
                  </a>
                ) : (
                  <span className="text-faint">null</span>
                )}
              </FieldRow>
              <FieldRow name="rail">{record.settlement.rail}</FieldRow>
              <FieldRow name="settled_at">
                <span className="font-mono text-[12px]">
                  {record.settlement.settled_at ?? "null"}
                </span>
              </FieldRow>
            </>
          ) : (
            <FieldRow name="settlement">
              null — no payment request constructed
            </FieldRow>
          )}
          <FieldRow name="anchor.record_hash">
            <span className="font-mono text-[12px]">
              {anchor?.record_hash ?? "—"}
            </span>
          </FieldRow>
          <FieldRow name="anchor.tx_hash">
            {anchor?.anchor_tx_hash ? (
              <a
                href={explorerTx(anchor.anchor_tx_hash)}
                className="font-mono text-[12px] text-accent hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                {shortHash(anchor.anchor_tx_hash)}
              </a>
            ) : (
              <span className="font-mono text-[12px] text-faint">
                {anchor?.status ?? "—"}
              </span>
            )}
          </FieldRow>
        </Section>

        <details className="mt-4 rounded-[3px] border border-border bg-chrome p-3">
          <summary className="cursor-pointer text-[12px] font-medium text-mute">
            View raw JSON
          </summary>
          <pre className="mt-3 overflow-auto font-mono text-[11px] text-ink">
            {JSON.stringify({ record, action, anchor, mandate }, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
