import type { Locale } from "./i18n.ts";
import { expectedDrawAt } from "./drawSchedule.ts";

/** Retail dates use the expected draw time; raw observations and ordering remain unchanged. */
export function formatDrawTime(
  timestamp: number,
  locale: Locale,
  timeZone: string,
) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(expectedDrawAt(timestamp) * 1000);
}
