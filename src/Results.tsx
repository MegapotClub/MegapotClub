import { formatDrawTime } from "./dateFormat.ts";
import { Identity } from "./Identity.tsx";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Locale, Messages } from "./i18n.ts";
import type { Snapshot } from "./model.ts";
import { money } from "./model.ts";
import type { Route } from "./navigation.ts";
import { playCopy } from "./playCopy.ts";
import { DrawTime, useLocalTimeZone } from "./drawTime.tsx";
import { NumberBalls, RouteLink } from "./RetailPrimitives.tsx";
import { winsQuery, prizeTiersQuery } from "./megapotApi.ts";
import { useRecentWins } from "./useRecentWins.ts";
import {
  ALL_TIME_JACKPOT_WINNERS_LOWER_BOUND,
  wholeDollarLowerBound,
} from "./resultStats.ts";

function RecentWinners({
  query,
  locale,
}: {
  query: ReturnType<typeof useRecentWins>["winners"];
  locale: Locale;
}) {
  const p = playCopy(locale);
  return (
    <section className="result-winners">
      <h3>{p("recentWins")}</h3>
      {query.isPending && <p role="status">{p("results")}…</p>}
      {query.isError && (
        <p className="inline-notice" role="status">
          {query.data ? p("updatesDelayed") : p("unknown")}
        </p>
      )}
      {query.data?.data.map((win) => (
        <a
          key={`${win.round_id}:${win.wallet.toLowerCase()}`}
          href={`https://basescan.org/address/${win.wallet}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="recent-winner-identity">
            <Identity address={win.wallet} />
            <DrawTime timestamp={win.time} locale={locale} />
          </span>
          <strong>${money(win.total_payout.amount, locale, 2)}</strong>
          <ExternalLink size={15} />
        </a>
      ))}
    </section>
  );
}
export function ResultWinners({
  draw,
  locale,
}: {
  draw: string;
  locale: Locale;
}) {
  const p = playCopy(locale),
    q = useQuery(winsQuery(draw));
  if (!q.data?.data.length)
    return q.isPending || q.isError ? (
      <p className="fine-print" role="status">
        {q.isPending ? `${p("results")}…` : p("unknown")}
      </p>
    ) : null;
  return (
    <section className="result-winners">
      <h3>{p("recentWins")}</h3>
      {q.isError && (
        <p className="inline-notice" role="status">
          {p("updatesDelayed")}
        </p>
      )}
      {q.data.data.map((w) => (
        <a
          href={`https://basescan.org/address/${w.wallet}`}
          target="_blank"
          rel="noreferrer"
          key={w.id}
        >
          <span>
            <Identity address={w.wallet} />
          </span>
          <strong>${money(w.amount.amount, locale, 2)}</strong>
          <ExternalLink size={15} />
        </a>
      ))}
    </section>
  );
}
export function ResultDetails({
  draw,
  locale,
  route,
  navigate,
}: {
  draw: string;
  locale: Locale;
  route: Route;
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale),
    q = useQuery({
      ...prizeTiersQuery(draw),
      enabled: route.resultTab === "prizes",
    });
  return (
    <>
      <nav className="retail-segment" aria-label={p("drawResult")}>
        <RouteLink
          to={{ ...route, resultTab: undefined }}
          navigate={navigate}
          className={!route.resultTab ? "selected" : ""}
        >
          {p("winners")}
        </RouteLink>
        <RouteLink
          to={{ ...route, resultTab: "prizes" }}
          navigate={navigate}
          className={route.resultTab === "prizes" ? "selected" : ""}
        >
          {p("prizeTiers")}
        </RouteLink>
      </nav>
      {route.resultTab === "prizes" ? (
        <div className="prize-tier-table">
          {q.isPending && <p role="status">{p("checkingPrizes")}</p>}
          {q.isError && <p className="inline-notice">{p("unknown")}</p>}
          {q.data && (
            <>
              <p className="fine-print">
                {p("grossPayout")}
                {q.data.status !== "settled" ? ` · ${p("resultPending")}` : ""}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>{p("numbersLabel")}</th>
                    <th>{p("grossPayout")}</th>
                    <th>{p("tickets")}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.data
                    .filter((t) => BigInt(t.payout.amount) > 0n)
                    .sort((a, b) => b.tier_id - a.tier_id)
                    .map((t) => (
                      <tr key={t.tier_id}>
                        <td>
                          {t.normal_matches}{" "}
                          {t.bonusball_match ? `+ ${p("bonus")}` : ""}
                        </td>
                        <td>${money(t.payout.amount, locale, 2)}</td>
                        <td>{t.ticket_count.toLocaleString(locale)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <ResultWinners draw={draw} locale={locale} />
      )}
    </>
  );
}
export function Results({
  snapshot,
  locale,
  messages: m,
  navigate,
  stale,
}: {
  snapshot: Snapshot;
  locale: Locale;
  messages: Messages;
  navigate: (r: Route) => void;
  stale: boolean;
}) {
  const p = playCopy(locale),
    [older, setOlder] = useState("");
  const { history, winners } = useRecentWins();
  const stats = history.data.stats;
  const zone = useLocalTimeZone();
  const earlier = Object.entries(history.data.dates)
    .filter(
      ([id]) =>
        Number(id) > 0 &&
        Number(id) < Number(snapshot.recent.at(-1)?.id ?? stats.through.id),
    )
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  return (
    <section className="retail-page results-retail">
      <div className="section-top">
        <h1>{p("results")}</h1>
      </div>
      <section className="results-totals" aria-label={p("winners")}>
        <div>
          <strong>
            {ALL_TIME_JACKPOT_WINNERS_LOWER_BOUND.toLocaleString(locale)}+
          </strong>
          <span>{p("jackpotWinners")}</span>
        </div>
        <div>
          <strong>
            ${money(wholeDollarLowerBound(stats.awarded), locale)}+
          </strong>
          <span>{p("prizesAwarded")}</span>
        </div>
        {stats.largest && (
          <div>
            <strong>${money(stats.largest.jackpot, locale)}</strong>
            <span>{p("largestJackpot")}</span>
            <DrawTime timestamp={stats.largest.time} locale={locale} />
          </div>
        )}
      </section>
      {history.isError && (
        <p className="inline-notice" role="status">
          {p("updatesDelayed")}
        </p>
      )}
      <RecentWinners query={winners} locale={locale} />
      <div className="result-card-grid">
        {snapshot.recent.map((draw, index) => (
          <RouteLink
            key={draw.id}
            to={{ view: "results", draw: draw.id }}
            navigate={navigate}
            className={`retail-result-card ${index === 0 ? "latest" : ""}`}
          >
            <div className="section-top">
              <DrawTime timestamp={draw.closesAt} locale={locale} />
              <ArrowRight size={19} />
            </div>
            {draw.result ? (
              <NumberBalls
                numbers={draw.result.numbers}
                bonus={draw.result.bonus}
              />
            ) : (
              <p>{p("resultPending")}</p>
            )}
            <div className="retail-result-facts">
              <span>
                {p("ticketTotal", {
                  count: Number(draw.ticketCount).toLocaleString(locale),
                })}
              </span>
            </div>
          </RouteLink>
        ))}
      </div>
      {stale && (
        <p className="inline-notice" role="status">
          {p("updatesDelayed")}
        </p>
      )}

      <details className="older-result-search">
        <summary>{p("older")}</summary>
        <form
          className="historical-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (older || earlier[0])
              navigate({ view: "results", draw: older || earlier[0][0] });
          }}
        >
          <label htmlFor="result-draw">
            {m.chooseDraw}
            <select
              id="result-draw"
              value={older || earlier[0]?.[0] || ""}
              onChange={(e) => setOlder(e.target.value)}
            >
              {earlier.map(([id, time]) => (
                <option key={id} value={id}>
                  {formatDrawTime(time, locale, zone)}
                </option>
              ))}
            </select>
          </label>
          <button className="button button-outline">{p("showDetails")}</button>
        </form>
      </details>
      <div className="retail-proof-links">
        <a
          href="https://docs.megapot.io/getting-started/provably-fair"
          target="_blank"
          rel="noreferrer"
        >
          {p("fairness")} ↗
        </a>
        <a
          href="https://docs.megapot.io/learn/audits"
          target="_blank"
          rel="noreferrer"
        >
          {p("audits")} ↗
        </a>
      </div>
    </section>
  );
}
