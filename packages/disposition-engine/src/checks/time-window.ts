import type { MandateControls } from "@safr/core";
import type { Check } from "../types.js";

/** Index matches JavaScript's getUTCDay(). */
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Minutes since midnight, or null if the range is malformed. */
function parseRange(range: string): { start: number; end: number } | null {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(range);
  if (!match) return null;
  const [, startHour, startMinute, endHour, endMinute] = match;
  return {
    start: Number(startHour) * 60 + Number(startMinute),
    end: Number(endHour) * 60 + Number(endMinute),
  };
}

/**
 * Whether an instant falls inside the mandate's allowed window.
 *
 * Everything is evaluated in UTC, matching the `allowed_hours_utc` field name. Both
 * ends of an hour range are inclusive, so the conventional "00:00-23:59" means the
 * whole day.
 */
export function withinAllowedWindow(
  proposedAt: string,
  timeWindow: MandateControls["time_window"],
): boolean {
  const at = new Date(proposedAt);
  if (Number.isNaN(at.getTime())) return false;

  const day = DAY_NAMES[at.getUTCDay()]!;
  if (!timeWindow.allowed_days.includes(day)) return false;

  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return timeWindow.allowed_hours_utc.some((range) => {
    const parsed = parseRange(range);
    return parsed !== null && minutes >= parsed.start && minutes <= parsed.end;
  });
}

/**
 * Bible Section 7.4, check 4 — time window is a hard boundary.
 *
 * Not exercised by the demo script, but Bible Section 7.4 requires it to populate
 * `rule` like every other path, so extending the system past the three scripted
 * scenarios does not silently produce a null `audit_log.rule_triggered`.
 */
export const timeWindowCheck: Check = (proposedAction, mandate) => {
  if (!withinAllowedWindow(proposedAction.proposed_at, mandate.controls.time_window)) {
    return {
      disposition: "DENY",
      reason: "outside_allowed_time_window",
      rule: "time_window",
    };
  }
  return null;
};
