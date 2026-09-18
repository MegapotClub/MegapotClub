import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { useLocalTimeZone } from "./drawTime.tsx";
import { playCopy } from "./playCopy.ts";
import { countdown } from "./model.ts";
import { DRAW_TIME_CYCLE_SECONDS, expectedDrawAt } from "./drawSchedule.ts";

/** Local schedule and countdown share the expected settlement timestamp. */
export function UpcomingDrawTime({
  timestamp,
  locale,
}: {
  timestamp: number;
  locale: Locale;
}) {
  const zone = useLocalTimeZone(),
    p = playCopy(locale),
    expectedAt = expectedDrawAt(timestamp);
  const [now, setNow] = useState<number | null>(null),
    [remaining, setRemaining] = useState(false);
  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let ticks = 0;
    setNow(Date.now());
    setRemaining(false);
    const timer = setInterval(() => {
      ticks++;
      setNow(Date.now());
      setRemaining(
        !reduced.matches &&
          Math.floor(ticks / DRAW_TIME_CYCLE_SECONDS) % 2 === 1,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [timestamp]);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(expectedAt * 1000);
  const daily = p("dailyAt", {
    time: locale === "en" ? time.toLowerCase() : time,
  });
  return (
    <time
      className="upcoming-draw-time"
      dateTime={new Date(expectedAt * 1000).toISOString()}
      aria-label={daily}
    >
      <CalendarDays size={15} aria-hidden="true" />
      <span aria-hidden="true">
        {remaining && now !== null
          ? countdown(expectedAt, now).join(":")
          : daily}
      </span>
    </time>
  );
}
