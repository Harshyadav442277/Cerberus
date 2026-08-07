"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL, explorerTx, fetchFeed, formatTime, shortHash } from "@/lib/api";
import type { FeedItem } from "@/lib/types";
import { DispositionBadge, dispositionRowClass } from "./DispositionBadge";

function mergeItems(prev: FeedItem[], incoming: FeedItem[]): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const item of [...incoming, ...prev]) {
    byId.set(item.record.audit_id, item);
  }
  return [...byId.values()].sort((a, b) =>
    a.record.evaluated_at < b.record.evaluated_at ? 1 : -1,
  );
}

export function AuditTable({ initial }: { initial: FeedItem[] }) {
  const [items, setItems] = useState(initial);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const known = useRef(new Set(initial.map((i) => i.record.audit_id)));

  const refresh = useCallback(async () => {
    const data = await fetchFeed();
    setItems(data.items);
    setCounts(data.counts);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // SSE with 1s polling fallback (Design §9 / Phases.md descope ladder).
  useEffect(() => {
    const es = new EventSource(`${API_URL}/audit/stream`);
    es.addEventListener("open", () => setLive(true));
    es.addEventListener("error", () => setLive(false));
    es.addEventListener("audit", (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          item: FeedItem;
        };
        const id = payload.item.record.audit_id;
        setItems((prev) => mergeItems(prev, [payload.item]));
        setLastEventAt(Date.now());
        if (!known.current.has(id)) {
          known.current.add(id);
          setFlash((prev) => new Set(prev).add(id));
          window.setTimeout(() => {
            setFlash((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }, 400);
        }
        void refresh();
      } catch {
        // ignore malformed events
      }
    });
    es.addEventListener("ping", () => setLive(true));

    const poll = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1000);

    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [refresh]);

  const ago = useMemo(() => {
    if (lastEventAt === null) return "waiting";
    const s = Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000));
    return s === 0 ? "just now" : `${s}s ago`;
  }, [lastEventAt, items]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-end justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Audit Log</h1>
          <p className="mt-0.5 text-[12px] text-mute">
            Every disposition — including refusals — is recorded before settlement.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-mute">
          <span
            className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-allow" : "bg-faint"}`}
          />
          <span className="font-medium text-ink">{live ? "Live" : "Reconnecting"}</span>
          <span>· last event {ago}</span>
        </div>
      </header>

      <div className="flex gap-3 border-b border-border bg-chrome px-6 py-3 text-[12px]">
        <SummaryChip label="ALLOW" value={counts.ALLOW ?? 0} tone="allow" />
        <SummaryChip label="DENY" value={counts.DENY ?? 0} tone="deny" />
        <SummaryChip label="ESCALATE" value={counts.ESCALATE ?? 0} tone="escalate" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-chrome text-left text-[11px] font-medium uppercase tracking-wide text-faint">
            <tr className="border-b border-border">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Disposition</th>
              <th className="px-4 py-2.5 font-medium">Agent</th>
              <th className="px-4 py-2.5 font-medium">Counterparty</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Rule Triggered</th>
              <th className="px-4 py-2.5 font-medium">Settlement</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const { record, action } = item;
              const settlement =
                record.disposition === "DENY"
                  ? null
                  : record.settlement?.tx_hash;
              return (
                <tr
                  key={record.audit_id}
                  className={`border-b border-border border-l-[3px] ${dispositionRowClass(record.disposition)} ${
                    flash.has(record.audit_id) ? "row-flash" : ""
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-[12px] tabular-nums">
                    <Link
                      href={`/audit/${record.audit_id}`}
                      className="text-ink hover:text-accent"
                    >
                      {formatTime(record.evaluated_at)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <DispositionBadge disposition={record.disposition} />
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px] text-mute">
                    {record.agent_id}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px]">
                    {action.payload.counterparty}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-[12px] tabular-nums">
                    {action.payload.amount.toFixed(2)} {action.payload.currency}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px]">
                    {record.rule_triggered ?? (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px]">
                    {settlement ? (
                      <a
                        href={explorerTx(settlement)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                        title={settlement}
                      >
                        {shortHash(settlement)}
                      </a>
                    ) : (
                      <span
                        className="text-faint"
                        title={
                          record.disposition === "DENY"
                            ? "no payment request constructed"
                            : record.settlement?.status === "failed"
                              ? "settlement failed"
                              : "—"
                        }
                      >
                        {record.settlement?.status === "failed" ? "failed" : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-mute">
                  No audit records yet. Run <code className="font-mono">npm run demo</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "allow" | "deny" | "escalate";
}) {
  const toneClass =
    tone === "allow"
      ? "text-allow"
      : tone === "deny"
        ? "text-deny"
        : "text-escalate";
  return (
    <span className="rounded-[3px] border border-border bg-white px-2.5 py-1">
      <span className={`font-medium ${toneClass}`}>{label}</span>
      <span className="ml-2 font-mono tabular-nums text-ink">{value}</span>
    </span>
  );
}
