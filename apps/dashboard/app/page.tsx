import { AuditTable } from "@/components/AuditTable";
import { fetchFeed } from "@/lib/api";
import type { FeedItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  let initial: FeedItem[] = [];
  try {
    const data = await fetchFeed();
    initial = data.items;
  } catch {
    initial = [];
  }
  return <AuditTable initial={initial} />;
}
