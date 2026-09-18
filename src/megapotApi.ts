import { parseResultRounds, summarizeResults } from "./resultStats.ts";
import resultSeed from "./resultsSnapshot.json" with { type: "json" };
import { queryOptions } from "@tanstack/react-query";
export type IndexedWin = {
  id: string;
  wallet: string;
  round_id: string;
  user_ticket_id: string;
  amount: { amount: string; decimals: 6 };
  claimed: boolean;
  claimed_tx_hash: string | null;
  normals: number[];
  bonusball: number;
};
export type PrizeTier = {
  tier_id: number;
  normal_matches: number;
  bonusball_match: boolean;
  payout: { amount: string; decimals: 6 };
  ticket_count: number;
};
export type IndexedPlayer = {
  wallet: string;
  total_ticket_count: number;
  winning_ticket_count: number;
  total_payout: { amount: string; decimals: 6 };
};
let cooldown = 0;
const starts: number[] = [];
let pendingReads = 0;
let readLane: Promise<unknown> = Promise.resolve();
/** Optional indexed display data. Never used to authorize or price a transaction. */
async function readApi(path: string, signal?: AbortSignal): Promise<unknown> {
  if (pendingReads >= 8) throw new Error("unavailable");
  pendingReads++;
  const task = readLane
    .catch(() => {})
    .then(() => performApiRead(path, signal));
  readLane = task;
  try {
    return await task;
  } finally {
    pendingReads--;
  }
}

/** One serial lane, at most eight starts/minute, no transport retries. */
async function performApiRead(
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  if (Date.now() < cooldown) throw new Error("unavailable");
  while (starts.length && starts[0] <= Date.now() - 60_000) starts.shift();
  if (starts.length >= 8) throw new Error("unavailable");
  starts.push(Date.now());
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 8000),
    abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const r = await fetch(`https://api.megapot.io/v1/${path}`, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    if (r.status === 429 || r.status === 503) {
      const retry = r.headers.get("retry-after"),
        seconds = Number(retry),
        until =
          retry && !Number.isFinite(seconds)
            ? Date.parse(retry)
            : Date.now() +
              Math.max(30, Number.isFinite(seconds) ? seconds : 30) * 1000;
      cooldown = Math.max(
        Date.now() + 30_000,
        Number.isFinite(until) ? until : 0,
      );
    }
    const reset = Number(r.headers.get("x-ratelimit-reset"));
    if (
      r.headers.get("x-ratelimit-remaining") === "0" &&
      Number.isFinite(reset)
    )
      cooldown = Math.max(cooldown, reset);
    if (!r.ok || !r.body) throw new Error("unavailable");
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let bytes = 0,
      text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1_048_576) throw new Error("invalidApi");
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
const uint = (v: unknown) =>
  typeof v === "string" &&
  /^(0|[1-9]\d{0,77})$/.test(v) &&
  BigInt(v) < 2n ** 256n;
const address = (v: unknown) =>
  typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const hash = (v: unknown) =>
  typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
/** @cc [label:data] indexed-wins-are-untrusted
 * Indexed records MUST be validated and scoped to the requested draw or wallet.
 * Indexed values MUST NOT authorize signing; claims remain independently verified onchain.
 */
export function parseIndexedWins(
  value: unknown,
  scope: { draw?: string; account?: string; claimed?: boolean },
  limit = 20,
): IndexedWin[] {
  const v = value as { data?: unknown[] };
  if (!v || !Array.isArray(v.data) || v.data.length > limit)
    throw new Error("invalidApi");
  return v.data.map((item) => {
    const w = item as IndexedWin,
      a = w?.amount;
    if (
      !w ||
      !address(w.wallet) ||
      !uint(w.user_ticket_id) ||
      !uint(w.round_id) ||
      !a ||
      a.decimals !== 6 ||
      !uint(a.amount) ||
      typeof w.claimed !== "boolean" ||
      (w.claimed_tx_hash !== null && !hash(w.claimed_tx_hash)) ||
      !Array.isArray(w.normals) ||
      w.normals.length !== 5 ||
      new Set(w.normals).size !== 5 ||
      w.normals.some((n) => !Number.isInteger(n) || n < 1 || n > 255) ||
      !Number.isInteger(w.bonusball) ||
      w.bonusball < 1 ||
      w.bonusball > 255 ||
      (scope.draw && String(w.round_id) !== scope.draw) ||
      (scope.account &&
        w.wallet.toLowerCase() !== scope.account.toLowerCase()) ||
      (scope.claimed !== undefined && w.claimed !== scope.claimed) ||
      (w.claimed && !w.claimed_tx_hash)
    )
      throw new Error("invalidApi");
    return {
      id: String(w.id).slice(0, 100),
      wallet: w.wallet,
      round_id: String(w.round_id),
      user_ticket_id: String(w.user_ticket_id),
      amount: { amount: a.amount, decimals: 6 },
      claimed: w.claimed,
      claimed_tx_hash: w.claimed_tx_hash,
      normals: [...w.normals],
      bonusball: w.bonusball,
    };
  });
}
export async function readRoundWins(draw: string, signal?: AbortSignal) {
  if (!/^[1-9]\d{0,17}$/.test(draw)) throw new Error("invalidDraw");
  return {
    data: parseIndexedWins(
      await readApi(`rounds/${draw}/wins?limit=5`, signal),
      { draw },
      5,
    ),
    observedAt: Date.now(),
  };
}

export function parseIndexedPlayers(value: unknown): IndexedPlayer[] {
  const v = value as { data?: IndexedPlayer[] };
  if (!Array.isArray(v?.data) || v.data.length > 5)
    throw new Error("invalidApi");
  const seen = new Set<string>();
  return v.data.map((player) => {
    if (
      !player ||
      !address(player.wallet) ||
      seen.has(player.wallet.toLowerCase()) ||
      !Number.isSafeInteger(player.total_ticket_count) ||
      player.total_ticket_count < 0 ||
      !Number.isSafeInteger(player.winning_ticket_count) ||
      player.winning_ticket_count < 0 ||
      player.winning_ticket_count > player.total_ticket_count ||
      player.total_payout?.decimals !== 6 ||
      !uint(player.total_payout.amount)
    )
      throw new Error("invalidApi");
    seen.add(player.wallet.toLowerCase());
    return {
      wallet: player.wallet,
      total_ticket_count: player.total_ticket_count,
      winning_ticket_count: player.winning_ticket_count,
      total_payout: { amount: player.total_payout.amount, decimals: 6 },
    };
  });
}

export async function readRoundPlayers(draw: string, signal?: AbortSignal) {
  if (!/^[1-9]\d{0,17}$/.test(draw)) throw new Error("invalidDraw");
  return {
    data: parseIndexedPlayers(
      await readApi(`rounds/${draw}/players?limit=5`, signal),
    ),
    observedAt: Date.now(),
  };
}
export async function readWalletWins(
  account: string,
  signal?: AbortSignal,
  cursor?: string,
) {
  if (!address(account)) throw new Error("invalidAddress");
  if (cursor && !/^[A-Za-z0-9_=-]{1,2048}$/.test(cursor))
    throw new Error("invalidApi");
  const result = await readApi(
    `wallets/${account}/wins?claimed=true&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    signal,
  );
  return {
    data: parseIndexedWins(result, { account, claimed: true }, 100),
    nextCursor: parseNextCursor(result),
    observedAt: Date.now(),
  };
}

export function parseNextCursor(value: unknown): string | undefined {
  const v = value as { has_more?: unknown; next_cursor?: unknown };
  if (v.has_more === undefined || v.has_more === false) return undefined;
  if (
    v.has_more !== true ||
    typeof v.next_cursor !== "string" ||
    !/^[A-Za-z0-9_=-]{1,2048}$/.test(v.next_cursor)
  )
    throw new Error("invalidApi");
  return v.next_cursor;
}

export async function readResultHistory(signal?: AbortSignal) {
  const latest = parseResultRounds(await readApi("rounds?limit=100", signal));
  return {
    dates: {
      ...Object.fromEntries(resultSeed.rows.map((row) => [row.id, row.time])),
      ...latest.dates,
    },
    stats: summarizeResults(resultSeed.rows, latest.rows),
  };
}
export const resultHistorySeed = {
  dates: Object.fromEntries(resultSeed.rows.map((row) => [row.id, row.time])),
  stats: summarizeResults(resultSeed.rows),
};
export async function readPrizeTiers(draw: string, signal?: AbortSignal) {
  if (!/^[1-9]\d{0,17}$/.test(draw)) throw new Error("invalidDraw");
  const v = (await readApi(`rounds/${draw}`, signal)) as {
    id: string;
    status: string;
    prize_tiers: PrizeTier[] | null;
  };
  if (
    String(v?.id) !== draw ||
    !["active", "settled"].includes(v.status) ||
    !Array.isArray(v.prize_tiers) ||
    v.prize_tiers.length !== 12 ||
    new Set(v.prize_tiers.map((t) => t.tier_id)).size !== 12
  )
    throw new Error("invalidApi");
  for (const t of v.prize_tiers)
    if (
      !Number.isInteger(t.tier_id) ||
      t.tier_id < 0 ||
      t.tier_id > 11 ||
      t.normal_matches !== Math.floor(t.tier_id / 2) ||
      t.bonusball_match !== (t.tier_id % 2 === 1) ||
      t.payout?.decimals !== 6 ||
      !uint(t.payout.amount) ||
      !Number.isSafeInteger(t.ticket_count) ||
      t.ticket_count < 0
    )
      throw new Error("invalidApi");
  return { data: v.prize_tiers, status: v.status, observedAt: Date.now() };
}
const policy = {
  staleTime: 900_000,
  gcTime: typeof window === "undefined" ? Infinity : 3_600_000,
  refetchInterval: 900_000,
  refetchIntervalInBackground: false,
  retry: false as const,
  refetchOnWindowFocus: false,
};
export const winsQuery = (draw?: string) =>
  queryOptions({
    queryKey: ["megapot-api", "round-wins", draw],
    enabled: Boolean(draw),
    queryFn: ({ signal }) => readRoundWins(draw!, signal),
    ...policy,
  });
export const prizeTiersQuery = (draw: string) =>
  queryOptions({
    queryKey: ["megapot-api", "prize-tiers", draw],
    queryFn: ({ signal }) => readPrizeTiers(draw, signal),
    ...policy,
  });
export const roundDatesQuery = () =>
  queryOptions({
    queryKey: ["megapot-api", "result-history"],
    queryFn: ({ signal }) => readResultHistory(signal),
    ...policy,
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
    initialData: resultHistorySeed,
    initialDataUpdatedAt: 1,
  });
