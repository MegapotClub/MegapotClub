import { queryOptions } from "@tanstack/react-query";
import {
  parseIndexedPlayers,
  readRoundPlayers,
  type IndexedPlayer,
} from "./megapotApi.ts";
import type { ResultRow } from "./resultStats.ts";
import seed from "./recentWinsSnapshot.json" with { type: "json" };

export const RECENT_WIN_DAYS = 14;
export const RECENT_WIN_LIMIT = 5;
type WinRound = {
  id: string;
  time: number;
  wins: IndexedPlayer[];
  observedAt?: number;
};
const archive = new Map<string, WinRound>(
  (seed.rounds as WinRound[]).map((round) => [
    round.id,
    {
      ...round,
      observedAt: seed.observedAt / 1000,
      wins: parseIndexedPlayers({ data: round.wins }),
    },
  ]),
);

export function rankRecentWins(rounds: WinRound[], now: number) {
  const windowStart = now - RECENT_WIN_DAYS * 86_400;
  const seen = new Set<string>();
  const data = rounds
    .filter((round) => round.time >= windowStart && round.time <= now)
    .flatMap((round) =>
      round.wins.map((win) => ({
        ...win,
        round_id: round.id,
        time: round.time,
      })),
    )
    .filter((win) => {
      const key = `${win.round_id}:${win.wallet.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return BigInt(win.total_payout.amount) > 0n;
    })
    .sort((a, b) => {
      const difference =
        BigInt(b.total_payout.amount) - BigInt(a.total_payout.amount);
      return difference > 0n
        ? 1
        : difference < 0n
          ? -1
          : b.time - a.time ||
            a.wallet.toLowerCase().localeCompare(b.wallet.toLowerCase(), "en");
    })
    .slice(0, RECENT_WIN_LIMIT);
  return { data, windowStart, windowEnd: now };
}

/** @cc [label:data] complete-recent-winners
 * A top-five ranking MUST consider the top five wallet totals from every settled draw in its fourteen-day window.
 * A failed/incomplete read MUST NOT replace the last complete ranking. Amounts are display-only.
 */
export async function readRecentWins(
  rows: ResultRow[],
  now: number,
  signal?: AbortSignal,
) {
  const wanted = rows.filter(
    (row) => row.time >= now - RECENT_WIN_DAYS * 86_400 && row.time <= now,
  );
  const rounds: WinRound[] = [];
  const latest = new Set(rows.slice(-2).map((row) => row.id));
  for (const row of wanted) {
    signal?.throwIfAborted();
    let cached = archive.get(row.id);
    if (
      !cached ||
      cached.time !== row.time ||
      (latest.has(row.id) && now - (cached.observedAt ?? 0) >= 900)
    ) {
      const result = await readRoundPlayers(row.id, signal);
      cached = {
        id: row.id,
        time: row.time,
        wins: result.data,
        observedAt: now,
      };
      archive.set(row.id, cached);
    }
    rounds.push(cached);
  }
  // Refresh the two newest settled draws for late indexed records; retain older history.
  for (const [id, round] of archive)
    if (round.time < now - 30 * 86_400) archive.delete(id);
  while (archive.size > 64) archive.delete(archive.keys().next().value!);
  return rankRecentWins(rounds, now);
}

export const recentWinsQuery = (rows: ResultRow[]) =>
  queryOptions({
    queryKey: ["megapot-api", "recent-largest-wins", rows.at(-1)?.id],
    queryFn: ({ signal }) => readRecentWins(rows, Date.now() / 1000, signal),
    initialData: () =>
      seed.observedAt > 0 &&
      rows.at(-1)?.id === (seed.rounds as WinRound[]).at(-1)?.id
        ? rankRecentWins(seed.rounds as WinRound[], seed.observedAt / 1000)
        : undefined,
    initialDataUpdatedAt: seed.observedAt,
    staleTime: 900_000,
    refetchInterval: 900_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: false,
  });
