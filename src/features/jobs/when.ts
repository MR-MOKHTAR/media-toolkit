import type { TFunction } from "i18next";

import { daysFromToday, formatClock } from "../../lib/format";

/** "today at 02:00", "tomorrow at 02:00", or "in 3 days at 02:00" -- whichever
 *  is nearest the way a person would say when something is going to happen. */
export function describeWhen(at: number, t: TFunction): string {
  const time = formatClock(at);
  const day = daysFromToday(at);
  if (day <= 0) return t("schedule_today", { time });
  if (day === 1) return t("schedule_tomorrow", { time });
  return t("schedule_in_days", { time, days: String(day) });
}

/** The next moment the clock reads `HH:MM`: today if that is still ahead,
 *  tomorrow otherwise. */
export function nextOccurrence(clock: string, now = new Date()): number {
  const [hours, minutes] = clock.split(":").map(Number);
  const next = new Date(now);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}
