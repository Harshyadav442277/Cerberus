"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchHealth } from "@/lib/api";
import type { Health } from "@/lib/types";

const NAV = [
  { href: "/", label: "Audit Log" },
  { href: "/escalations", label: "Escalations" },
  { href: "/mandate", label: "Mandate" },
  { href: "/agent", label: "Agent" },
];

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-allow" : "bg-deny"}`}
      aria-hidden
    />
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchHealth()
        .then((h) => {
          if (!cancelled) setHealth(h);
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-chrome">
      <div className="px-5 pb-6 pt-6">
        <div className="text-[15px] font-semibold tracking-tight text-ink">SAFR</div>
        <div className="text-[13px] text-mute">Runtime</div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-[3px] px-3 py-2 text-[13px] ${
                active
                  ? "bg-white font-medium text-ink shadow-[0_0_0_1px_#E2E5EA]"
                  : "text-mute hover:bg-white/70 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-1.5 border-t border-border px-5 py-4 text-[11px] text-faint">
        <div className="flex items-center gap-2">
          <Dot ok={Boolean(health?.ok)} />
          <span>{health?.network_label ?? "Base Sepolia"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Dot ok={health?.database === "up"} />
          <span>Database</span>
        </div>
        <div className="flex items-center gap-2">
          <Dot ok={Boolean(health?.facilitator)} />
          <span>Facilitator</span>
        </div>
      </div>
    </aside>
  );
}
