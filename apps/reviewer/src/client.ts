export type Decision = "approved" | "denied";

export interface PendingEscalation {
  action: { action_id: string };
  record: { mandate_version: number };
}

export function createReviewerApiClient(options: {
  apiBaseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}) {
  const request = options.fetchImpl ?? fetch;
  const authorization = `Bearer ${options.token}`;

  return {
    async pending(): Promise<PendingEscalation[]> {
      const response = await request(`${options.apiBaseUrl}/escalations`, {
        headers: { authorization },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`pending escalations request failed (${response.status})`);
      const body = (await response.json()) as { items?: PendingEscalation[] };
      return Array.isArray(body.items) ? body.items : [];
    },

    async decide(item: PendingEscalation, decision: Decision, note: string): Promise<void> {
      const response = await request(
        `${options.apiBaseUrl}/escalations/${encodeURIComponent(item.action.action_id)}/decision`,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            decision,
            note,
            mandate_version: item.record.mandate_version,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `review decision failed (${response.status})`);
      }
    },
  };
}
