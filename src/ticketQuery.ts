import { queryOptions } from "@tanstack/react-query";
import type { Route } from "./navigation.ts";

/**
 * @cc [label:privacy] ticket-view-intent
 * An explicit public-address link MUST take precedence over the connected wallet.
 * Implicit wallet reads MUST follow the active account and MUST NOT add it to a URL or storage.
 */
export function ticketScope(
  route: Route,
  account: string | undefined,
  currentDraw: string,
) {
  return {
    address: route.address ?? account,
    drawId: route.draw ?? currentDraw,
    public: Boolean(route.address),
  };
}

/**
 * @cc [label:data] ticket-read-isolation
 * A displayed ticket observation MUST belong to the selected address, draw and RPC configuration.
 * A failed refresh MUST retain the same query's last valid observation, never another account's data.
 * Reads and retries MUST NOT access a wallet provider or request a signature.
 */
export function ticketQueryOptions(
  urls: string[],
  scope: ReturnType<typeof ticketScope>,
) {
  return queryOptions({
    queryKey: [
      "tickets",
      urls,
      scope.address?.toLowerCase() ?? null,
      scope.drawId,
    ] as const,
    enabled: Boolean(scope.address),
    queryFn: async ({ signal }) => {
      if (!scope.address) throw new Error("missingAddress");
      const { fetchTickets } = await import("./chain.ts");
      return fetchTickets(urls, scope.address, scope.drawId, signal);
    },
    retry: false,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchInterval: (query) => (query.state.error ? 300_000 : 120_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
}
