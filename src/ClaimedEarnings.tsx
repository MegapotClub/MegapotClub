import { NumberBalls, RouteLink } from "./RetailPrimitives.tsx";
import { ticketCopy } from "./ticketCopy.ts";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, ArrowRight } from "lucide-react";
import { readWalletWins, roundDatesQuery } from "./megapotApi.ts";
import type { Locale } from "./i18n.ts";
import type { Route } from "./navigation.ts";
import { playCopy } from "./playCopy.ts";
import { money } from "./model.ts";
import { DrawTime } from "./drawTime.tsx";

import { groupClaimedWins } from "./claimedWins.ts";

export function ClaimedEarnings({
  account,
  locale,
  navigate,
}: {
  account: string;
  locale: Locale;
  navigate: (r: Route) => void;
}) {
  const p = playCopy(locale);
  const recent = useQuery({
    queryKey: ["megapot-api", "wallet-wins", account.toLowerCase(), "recent"],
    queryFn: ({ signal }) => readWalletWins(account, signal),
    staleTime: 900_000,
    gcTime: 3_600_000,
    refetchInterval: 900_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const older = useInfiniteQuery({
    queryKey: ["megapot-api", "wallet-wins", account.toLowerCase(), "older"],
    initialPageParam: recent.data?.nextCursor,
    queryFn: ({ signal, pageParam }) => {
      if (!pageParam) throw new Error("invalidApi");
      return readWalletWins(account, signal, pageParam);
    },
    enabled: false,
    getNextPageParam: (last, pages) =>
      last.nextCursor &&
      !pages.slice(0, -1).some((page) => page.nextCursor === last.nextCursor)
        ? last.nextCursor
        : undefined,
    staleTime: Infinity,
    gcTime: 300_000,
    retry: false,
  });
  // Settled historical pages load on demand; the recent page keeps updating independently.
  const groups = groupClaimedWins([
    ...(recent.data?.data ?? []),
    ...(older.data?.pages.flatMap((page) => page.data) ?? []),
  ]);
  const hasMore = older.data
    ? older.hasNextPage
    : Boolean(recent.data?.nextCursor);
  const dates = useQuery({ ...roundDatesQuery(), enabled: groups.length > 0 });
  if (recent.isSuccess && !groups.length) return null;
  return (
    <section className="claimed-earnings">
      <h3>{p("paid")}</h3>
      {recent.isPending && <p role="status">{p("checkingPrizes")}</p>}
      {recent.isError && (
        <p className="inline-notice" role="status">
          {recent.data ? p("updatesDelayed") : p("prizeReadError")}
        </p>
      )}
      {groups.map((group) => (
        <article className="earning-summary" key={group.draw}>
          <Check size={20} aria-hidden="true" />
          <div className="earning-summary-label">
            <strong>
              {p("paid")} ·{" "}
              {group.wins.length === 1
                ? ticketCopy(locale)("oneTicket")
                : p("ticketTotal", {
                    count: group.wins.length.toLocaleString(locale),
                  })}
            </strong>
            {dates.data?.dates[group.draw] && (
              <DrawTime
                timestamp={dates.data.dates[group.draw]}
                locale={locale}
              />
            )}
          </div>
          <strong>${money(group.total.toString(), locale, 2)} USDC</strong>
          <details className="earning-group-details">
            <summary>{p("showDetails")}</summary>
            {group.wins.map((win) => (
              <NumberBalls
                key={win.user_ticket_id}
                numbers={win.normals}
                bonus={win.bonusball}
                small
              />
            ))}
          </details>
          <div className="earning-receipts">
            {[
              ...new Set(
                group.wins.map((win) => win.claimed_tx_hash).filter(Boolean),
              ),
            ].map((hash, index) => (
              <a
                key={hash}
                href={`https://basescan.org/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
                className="icon-button"
                title={p("viewTransaction")}
                aria-label={`${p("viewTransaction")} ${index + 1}`}
              >
                <ExternalLink size={17} />
              </a>
            ))}
          </div>
        </article>
      ))}
      {groups.length > 0 && (
        <RouteLink
          to={{ view: "play" }}
          navigate={navigate}
          className="text-button"
        >
          {p("playAgain")}
          <ArrowRight size={16} />
        </RouteLink>
      )}
      {older.isError && (
        <p className="inline-notice" role="status">
          {p("prizeReadError")}
        </p>
      )}
      {hasMore && (
        <button
          className="button button-outline full-width"
          disabled={older.isFetchingNextPage}
          onClick={() => void older.fetchNextPage()}
        >
          {older.isFetchingNextPage ? p("checkingPrizes") : p("loadMore")}
        </button>
      )}
    </section>
  );
}
