import type { Disposition } from "@/lib/types";

const STYLES: Record<Disposition, string> = {
  ALLOW: "text-allow border-allow bg-allow-soft",
  DENY: "text-deny border-deny bg-deny-soft",
  ESCALATE: "text-escalate border-escalate bg-escalate-soft",
  OBSERVE: "text-observe border-observe bg-observe-soft",
};

export function DispositionBadge({ disposition }: { disposition: Disposition }) {
  return (
    <span
      className={`inline-flex items-center rounded-[2px] border px-1.5 py-0.5 text-[11px] font-medium tracking-wide ${STYLES[disposition]}`}
    >
      {disposition}
    </span>
  );
}

export function dispositionRowClass(disposition: Disposition): string {
  switch (disposition) {
    case "ALLOW":
      return "border-l-allow bg-allow-soft/40";
    case "DENY":
      return "border-l-deny bg-deny-soft/50";
    case "ESCALATE":
      return "border-l-escalate bg-escalate-soft/50";
    case "OBSERVE":
      return "border-l-observe bg-observe-soft/50";
  }
}
