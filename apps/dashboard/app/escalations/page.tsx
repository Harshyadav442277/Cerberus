"use client";

import { useCallback, useEffect, useState } from "react";
import { DispositionBadge } from "@/components/DispositionBadge";
import { fetchEscalations, formatTime, submitDecision } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

export default function EscalationsPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("Verified merchant_new via out-of-band call");

  const refresh = useCallback(async () => {
    const data = await fetchEscalations();
    setItems(data.items);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(
    actionId: string,
    decision: "approved" | "denied",
    mandateVersion: number,
  ) {
    setBusy(actionId);
    setError(null);
    try {
      await submitDecision(actionId, decision, note, mandateVersion);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-[18px] font-semibold tracking-tight">Escalations</h1>
        <p className="mt-0.5 text-[12px] text-mute">
          Pending human review. Approve is one click — no confirmation dialog.
        </p>
      </header>

      <div className="border-b border-border bg-chrome px-6 py-3">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-faint">
          Decision note
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full max-w-xl rounded-[3px] border border-border bg-white px-3 py-1.5 text-[13px] outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-[12px] text-deny">{error}</p>}
      </div>

      <div className="space-y-3 overflow-auto px-6 py-4">
        {items.map((item) => {
          const waitingMs =
            Date.now() - new Date(item.record.evaluated_at).getTime();
          const waitingSec = Math.max(0, Math.floor(waitingMs / 1000));
          return (
            <article
              key={item.record.audit_id}
              className="rounded-[3px] border border-escalate bg-escalate-soft/40 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <DispositionBadge disposition="ESCALATE" />
                    <span className="font-mono text-[12px] text-mute">
                      {formatTime(item.record.evaluated_at)} · waiting {waitingSec}s
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[13px]">
                    {item.action.payload.amount} {item.action.payload.currency} →{" "}
                    {item.action.payload.counterparty}
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-mute">
                    rule: {item.record.rule_triggered} · {item.record.reason}
                  </p>
                  <p className="mt-1 text-[12px] text-mute">
                    {item.action.payload.purpose} · {item.action.payload.reference}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy === item.action.action_id}
                    onClick={() =>
                      void decide(item.action.action_id, "approved", item.record.mandate_version)
                    }
                    className="rounded-[3px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy === item.action.action_id}
                    onClick={() =>
                      void decide(item.action.action_id, "denied", item.record.mandate_version)
                    }
                    className="rounded-[3px] border border-deny px-3 py-1.5 text-[13px] font-medium text-deny hover:bg-deny-soft disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {items.length === 0 && (
          <p className="py-10 text-center text-[13px] text-mute">
            No pending escalations. Run{" "}
            <code className="font-mono">
              npm run demo -- new_counterparty --live-escalation
            </code>{" "}
            with the API up.
          </p>
        )}
      </div>
    </div>
  );
}
