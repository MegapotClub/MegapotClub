export type ResultRow = {
  id: string;
  time: number;
  jackpots: number;
  jackpot: string;
  awarded: string;
};
// Megapot's published all-time lower bound, recorded September 18, 2026.
// This is a reported lower bound, not a V2-only count or a sum of unique onchain addresses.
export const ALL_TIME_JACKPOT_WINNERS_LOWER_BOUND = 20;

export function wholeDollarLowerBound(raw: string): string {
  return ((BigInt(raw) / 1_000_000n) * 1_000_000n).toString();
}
const amount = (v: unknown): v is string =>
  typeof v === "string" &&
  /^(0|[1-9]\d{0,77})$/.test(v) &&
  BigInt(v) < 2n ** 256n;

/** @cc [label:data] complete-result-totals
 * Aggregate display amounts MUST cover contiguous settled rounds and MUST NOT be labeled claimed or paid.
 * API totals are display-only; they MUST NOT authorize any wallet action.
 */
export function parseResultRounds(value: unknown) {
  const v = value as { data?: unknown[] };
  if (!Array.isArray(v?.data) || v.data.length > 100)
    throw new Error("invalidApi");
  const dates: Record<string, number> = Object.create(null),
    rows: ResultRow[] = [];
  const ids = new Set<string>();
  for (const item of v.data) {
    const r = item as {
      id: string;
      status: string;
      ended_at: string;
      prize_tiers: {
        tier_id: number;
        normal_matches: number;
        bonusball_match: boolean;
        payout: { amount: string; decimals: number };
        ticket_count: number;
      }[];
    };
    if (
      !r ||
      !/^(0|[1-9]\d{0,8})$/.test(r.id) ||
      ids.has(r.id) ||
      !["active", "settled"].includes(r.status)
    )
      throw new Error("invalidApi");
    ids.add(r.id);
    const time = Date.parse(r.ended_at) / 1000;
    if (!Number.isSafeInteger(time) || time < 1) throw new Error("invalidApi");
    dates[r.id] = time;
    if (r.status !== "settled" || r.id === "0") continue;
    if (
      !Array.isArray(r.prize_tiers) ||
      r.prize_tiers.length !== 12 ||
      new Set(r.prize_tiers.map((t) => t.tier_id)).size !== 12
    )
      throw new Error("invalidApi");
    let awarded = 0n;
    for (const t of r.prize_tiers) {
      if (
        !Number.isInteger(t.tier_id) ||
        t.tier_id < 0 ||
        t.tier_id > 11 ||
        t.normal_matches !== Math.floor(t.tier_id / 2) ||
        t.bonusball_match !== (t.tier_id % 2 === 1) ||
        t.payout?.decimals !== 6 ||
        !amount(t.payout.amount) ||
        !Number.isSafeInteger(t.ticket_count) ||
        t.ticket_count < 0
      )
        throw new Error("invalidApi");
      awarded += BigInt(t.payout.amount) * BigInt(t.ticket_count);
    }
    const jackpot = r.prize_tiers.find((t) => t.tier_id === 11)!;
    rows.push({
      id: r.id,
      time,
      jackpots: jackpot.ticket_count,
      jackpot: jackpot.payout.amount,
      awarded: awarded.toString(),
    });
  }
  return { rows, dates };
}

export function summarizeResults(seed: ResultRow[], latest: ResultRow[] = []) {
  const merged = new Map(seed.map((r) => [r.id, r]));
  for (const row of latest) merged.set(row.id, row);
  const rows = [...merged.values()].sort((a, b) => Number(a.id) - Number(b.id));
  if (!rows.length || rows.some((r, i) => Number(r.id) !== i + 1))
    throw new Error("incompleteResults");
  let jackpots = 0,
    awarded = 0n,
    largest: ResultRow | undefined;
  for (const row of rows) {
    if (
      !amount(row.jackpot) ||
      !amount(row.awarded) ||
      !Number.isSafeInteger(row.jackpots) ||
      row.jackpots < 0
    )
      throw new Error("invalidApi");
    jackpots += row.jackpots;
    awarded += BigInt(row.awarded);
    if (
      row.jackpots &&
      (!largest || BigInt(row.jackpot) > BigInt(largest.jackpot))
    )
      largest = row;
  }
  return {
    rounds: rows,
    jackpots,
    awarded: awarded.toString(),
    largest,
    through: rows.at(-1)!,
  };
}
