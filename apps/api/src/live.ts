import { EventEmitter } from "node:events";
import type { Response } from "express";
import { listAuditFeed, type AuditFeedItem } from "@safr/db";

/**
 * Live feed for the dashboard.
 *
 * SSE clients stay open; a one-second Postgres poll catches writes from the agent
 * process (which cannot share an in-memory bus). Same-process writes can also call
 * `publish()` to push immediately.
 *
 * Visually identical to WebSocket during a demo (Phases.md descope ladder item 3).
 */

export type LiveEvent =
  | { type: "audit"; item: AuditFeedItem }
  | { type: "ping"; at: string };

class LiveHub {
  private readonly bus = new EventEmitter();
  private cursor: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private clients = 0;

  constructor() {
    this.bus.setMaxListeners(50);
  }

  publish(item: AuditFeedItem): void {
    if (!this.cursor || item.record.evaluated_at > this.cursor) {
      this.cursor = item.record.evaluated_at;
    }
    this.bus.emit("event", { type: "audit", item } satisfies LiveEvent);
  }

  subscribe(res: Response): void {
    this.clients++;
    this.ensurePolling();

    const onEvent = (event: LiveEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    this.bus.on("event", onEvent);

    res.write(`event: ping\ndata: ${JSON.stringify({ type: "ping", at: new Date().toISOString() })}\n\n`);

    res.on("close", () => {
      this.bus.off("event", onEvent);
      this.clients--;
      if (this.clients === 0) this.stopPolling();
    });
  }

  private ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, 1000);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    try {
      const items = await listAuditFeed({
        limit: 50,
        since: this.cursor ?? undefined,
      });
      // list is newest-first; emit oldest-first so the UI appends in order.
      for (const item of [...items].reverse()) {
        this.publish(item);
      }
      this.bus.emit("event", {
        type: "ping",
        at: new Date().toISOString(),
      } satisfies LiveEvent);
    } catch {
      // A transient DB blip must not kill SSE clients.
    }
  }
}

export const liveHub = new LiveHub();
