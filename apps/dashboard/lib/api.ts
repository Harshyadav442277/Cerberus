import type { FeedItem, Health } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4050";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchFeed() {
  return getJson<{ items: FeedItem[]; counts: Record<string, number> }>("/audit");
}

export function fetchAudit(auditId: string) {
  return getJson<{ record: FeedItem["record"]; action: FeedItem["action"]; anchor: FeedItem["anchor"] }>(
    `/audit/${auditId}`,
  );
}

export function fetchEscalations() {
  return getJson<{ items: FeedItem[] }>("/escalations");
}

export function fetchMandate(agentId = "agent_treasury_01") {
  return getJson<{ mandate: Record<string, unknown> }>(`/mandates/active?agent_id=${agentId}`);
}

export function fetchAgent(agentId = "agent_treasury_01") {
  return getJson<{
    agent: Record<string, unknown>;
    counters: { rolling_total_24h: number; hourly_tx_count: number };
    mandate_id: string | null;
  }>(`/agents/${agentId}`);
}

export function fetchHealth() {
  return getJson<Health>("/health");
}

export async function submitDecision(
  actionId: string,
  decision: "approved" | "denied",
  note?: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/escalations/${actionId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `decision failed (${res.status})`);
  }
}

export function explorerTx(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

export function shortHash(hash: string | null | undefined, head = 6, tail = 4): string {
  if (!hash) return "—";
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head + 2)}…${hash.slice(-tail)}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(11, 19);
}
