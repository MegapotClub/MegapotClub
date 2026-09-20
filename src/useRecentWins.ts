import { useQuery } from "@tanstack/react-query";
import { roundDatesQuery } from "./megapotApi.ts";
import { recentWinsQuery } from "./recentWins.ts";

/** Home and Results share the same complete ranking and query cache. */
export function useRecentWins() {
  const history = useQuery(roundDatesQuery());
  const winners = useQuery({
    ...recentWinsQuery(history.data.stats.rounds),
    // Keep the cached display while the draw list loads. Starting against the
    // old list creates a cancelled, redundant request when its key changes.
    enabled: !history.isFetching,
  });
  return { history, winners };
}
