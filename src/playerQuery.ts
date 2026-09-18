import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fetchPlayerAccount } from "./chain.ts";
import { useTransactions } from "./transactions.ts";
export const playerQueryOptions = (urls: string[], account?: string | null) =>
  queryOptions({
    queryKey: ["player-account", urls, account?.toLowerCase() ?? null],
    enabled: Boolean(account),
    queryFn: ({ signal }) => fetchPlayerAccount(urls, account!, signal),
    retry: false,
    staleTime: 60_000,
    refetchInterval: (query) => (query.state.error ? 300_000 : 60_000),
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    gcTime: typeof window === "undefined" ? Infinity : 300_000,
    refetchOnWindowFocus: false,
  });
export function usePlayerAccount(urls: string[], account?: string | null) {
  return useQuery(playerQueryOptions(urls, account));
}
/** A confirmed receipt invalidates every display cache that may contain spent/burned tickets. */
export function useReceiptRefresh() {
  const entries = useTransactions(),
    client = useQueryClient(),
    previous = useRef<Set<string> | null>(null);
  useEffect(() => {
    const confirmed = new Set(
      entries.filter((e) => e.status === "confirmed").map((e) => e.id),
    );
    if (
      previous.current &&
      [...confirmed].some((id) => !previous.current!.has(id))
    )
      for (const key of [
        "player-account",
        "tickets",
        "ticket-archive",
        "megapot-api",
      ])
        void client.invalidateQueries({ queryKey: [key] });
    previous.current = confirmed;
  }, [entries, client]);
}
