import { UpcomingDrawTime } from "./UpcomingDrawTime.tsx";
import { Identity } from "./Identity.tsx";
import { ArrowRight, CircleHelp, Clock3, ShieldCheck } from "lucide-react";
import type { Locale } from "./i18n.ts";
import { money, type Snapshot } from "./model.ts";
import type { Route } from "./navigation.ts";
import { playCopy } from "./playCopy.ts";
import { DrawTime } from "./drawTime.tsx";
import { NumberBalls, RouteLink } from "./RetailPrimitives.tsx";
import { useRecentWins } from "./useRecentWins.ts";
export function RecentWins({ locale }: { locale: Locale }) {
  const p = playCopy(locale),
    { history, winners: query } = useRecentWins();
  const winners = query.data?.data ?? [];

  return (
    <div className="recent-wins-strip" aria-label={p("recentWins")}>
      {query.isPending && <span role="status">{p("results")}…</span>}
      {(history.isError || query.isError) && (
        <span role="status">
          {query.data ? p("updatesDelayed") : p("unknown")}
        </span>
      )}
      {winners.map((w) => (
        <a
          key={`${w.round_id}:${w.wallet.toLowerCase()}`}
          href={`https://basescan.org/address/${w.wallet}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>
            <Identity address={w.wallet} prefixOnly />
          </span>{" "}
          {p("win")} <strong>${money(w.total_payout.amount, locale, 2)}</strong>
        </a>
      ))}
    </div>
  );
}
export function RetailHome({
  snapshot,
  locale,
  navigate,
}: {
  snapshot: Snapshot;
  locale: Locale;
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale),
    draw = snapshot.current,
    latest = snapshot.recent.find((d) => d.result);
  return (
    <div className="retail-home">
      <RecentWins locale={locale} />
      <div className="home-prize">
        <span className="home-prize-label">{p("todayPool")}</span>
        <h1 id="prize-title">
          <span>$</span>
          {money(draw.prizePool, locale)}
        </h1>
        <RouteLink
          to={{ view: "play" }}
          navigate={navigate}
          className="button button-primary home-play"
        >
          {p("play")}
          <ArrowRight size={23} />
        </RouteLink>
        <div className="home-time">
          <Clock3 size={17} />
          <DrawTime timestamp={draw.closesAt} locale={locale} />
        </div>
        <div className="home-countdown">
          <UpcomingDrawTime timestamp={draw.closesAt} locale={locale} />
        </div>
      </div>
      <div className="home-secondary">
        {latest && (
          <section className="home-result">
            <div className="section-top">
              <h2>{p("recentResults")}</h2>
              <RouteLink to={{ view: "results" }} navigate={navigate}>
                {p("allResults")}
                <ArrowRight size={16} />
              </RouteLink>
            </div>
            <DrawTime timestamp={latest.closesAt} locale={locale} />
            <NumberBalls
              numbers={latest.result!.numbers}
              bonus={latest.result!.bonus}
            />
            <RouteLink
              to={{ view: "results", draw: latest.id }}
              navigate={navigate}
              className="text-button"
            >
              {p("showDetails")}
              <ArrowRight size={17} />
            </RouteLink>
          </section>
        )}
        <section className="home-learn">
          <RouteLink
            to={{ view: "play", detail: "help" }}
            navigate={navigate}
            className="learn-card"
          >
            <CircleHelp size={27} />
            <strong>{p("howToPlay")}</strong>
            <span>{p("howToPlayDetail")}</span>
          </RouteLink>
          <div className="learn-card fairness-card">
            <ShieldCheck size={27} />
            <strong>{p("fairness")}</strong>
            <a
              href="https://docs.megapot.io/getting-started/provably-fair"
              target="_blank"
              rel="noreferrer"
            >
              {p("protocolInfo")} ↗
            </a>
            <a
              className="stats-link"
              href="https://dune.com/megapot/megapot-v2"
              target="_blank"
              rel="noreferrer"
            >
              {p("stats")} ↗
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
