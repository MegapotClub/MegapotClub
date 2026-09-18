import type { IndexedWin } from "./megapotApi.ts";

export function groupClaimedWins(wins: IndexedWin[]) {
  const groups = new Map<
    string,
    { draw: string; total: bigint; wins: IndexedWin[] }
  >();
  const seen = new Set<string>();
  for (const win of wins) {
    const key = `${win.round_id}:${win.user_ticket_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groups.get(win.round_id) ?? {
      draw: win.round_id,
      total: 0n,
      wins: [],
    };
    group.total += BigInt(win.amount.amount);
    group.wins.push(win);
    groups.set(win.round_id, group);
  }
  return [...groups.values()].sort((a, b) =>
    BigInt(a.draw) > BigInt(b.draw) ? -1 : 1,
  );
}
