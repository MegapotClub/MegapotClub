import { useEffect, useState } from "react";
import type { Locale } from "./i18n.ts";

import { formatDrawTime } from "./dateFormat.ts";
import { expectedDrawAt } from "./drawSchedule.ts";

export function useLocalTimeZone() {
  const [zone, setZone] = useState("UTC");
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  return zone;
}

export function DrawTime({
  timestamp,
  locale,
}: {
  timestamp: number;
  locale: Locale;
}) {
  const zone = useLocalTimeZone();
  return (
    <time
      className="draw-date"
      dateTime={new Date(expectedDrawAt(timestamp) * 1000).toISOString()}
    >
      <span>{formatDrawTime(timestamp, locale, zone)}</span>
    </time>
  );
}
