import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays } from "lucide-react";
import type { Locale, Messages } from "./i18n.ts";
import { interpolate } from "./i18n.ts";
import type { Draw } from "./model.ts";
import { DrawTime } from "./drawTime.tsx";
import { experienceCopy } from "./experienceCopy.ts";
import { ticketCopy } from "./ticketCopy.ts";
import { fetchTicketCollections } from "./chain.ts";
import { normalNavigation, routeHref, type Route } from "./navigation.ts";

/** Bounded recent-draw discovery. Unknown and failed reads are never empty collections. */
export function TicketArchive({
  locale,
  messages: m,
  urls,
  address,
  publicAddress,
  draws,
  navigate,
}: {
  locale: Locale;
  messages: Messages;
  urls: string[];
  address: string;
  publicAddress?: string;
  draws: Draw[];
  navigate: (route: Route) => void;
}) {
  const e = experienceCopy(locale),
    t = ticketCopy(locale);
  const [older, setOlder] = useState("");
  const query = useQuery({
    queryKey: [
      "ticket-archive",
      urls,
      address.toLowerCase(),
      draws.map((draw) => draw.id),
    ],
    queryFn: ({ signal }) =>
      fetchTicketCollections(
        urls,
        address,
        draws.map((draw) => draw.id),
        signal,
      ),
    retry: false,
    staleTime: 300_000,
    gcTime: 300_000,
    refetchOnWindowFocus: false,
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
  return (
    <div className="ticket-archive">
      <div className="section-top">
        <h2>{e("past")}</h2>
      </div>
      <div className="archive-grid">
        {draws.map((draw, index) => {
          const q = query,
            data = q.data?.[index];
          if (data?.total === 0) return null;
          const next: Route = {
            view: "tickets",
            draw: draw.id,
            address: publicAddress,
          };
          const stale =
            data && (q.isError || Date.now() - data.blockTime * 1000 > 120_000);
          return (
            <a
              className={`archive-draw ${data?.total ? "has-tickets" : ""}`}
              key={draw.id}
              href={routeHref(next)}
              onClick={(event) => {
                if (normalNavigation(event)) {
                  event.preventDefault();
                  navigate(next);
                }
              }}
            >
              <span className="archive-date-mark" aria-hidden="true">
                <CalendarDays size={24} />
              </span>
              <span className="archive-draw-info">
                <DrawTime
                  timestamp={(data?.draw ?? draw).closesAt}
                  locale={locale}
                />
                <strong>
                  {data
                    ? data.total === 0
                      ? e("noTicketsShort")
                      : data.total === 1
                        ? t("oneTicket")
                        : interpolate(m.ticketCount, {
                            count: data.total.toLocaleString(locale),
                          })
                    : q.isError
                      ? e("unavailable")
                      : e("checking")}
                </strong>
                {stale && <small className="archive-stale">{m.stale}</small>}
              </span>
              <ArrowRight size={20} />
            </a>
          );
        })}
      </div>
      <p className="fine-print">
        {interpolate(e("historyCoverage"), { count: draws.length })}
      </p>
      <form
        className="historical-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (/^[1-9]\d{0,17}$/.test(older))
            navigate({ view: "tickets", draw: older, address: publicAddress });
        }}
      >
        <label htmlFor="archive-draw">
          {e("olderDraw")}
          <input
            id="archive-draw"
            inputMode="numeric"
            pattern="[1-9][0-9]{0,17}"
            maxLength={18}
            value={older}
            onChange={(event) => setOlder(event.target.value)}
            placeholder={draws.at(-1)?.id ?? "1"}
            required
          />
        </label>
        <button className="button button-outline">
          {e("viewTickets")}
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}
