import test from "node:test";
import assert from "node:assert/strict";
import { formatDrawTime } from "../src/dateFormat.ts";
import { expectedDrawAt } from "../src/drawSchedule.ts";
import { countdown, phase } from "../src/model.ts";
import snapshot from "../src/snapshot.json" with { type: "json" };
import { groupClaimedWins } from "../src/claimedWins.ts";
import {
  parseIndexedWins,
  parseNextCursor,
  readRoundWins,
  readWalletWins,
} from "../src/megapotApi.ts";
import { parseResultRounds, summarizeResults } from "../src/resultStats.ts";
import { readFileSync } from "node:fs";

test("draw dates follow local calendar boundaries and daylight saving", () => {
  const at = Date.parse("2026-09-18T01:05:00Z") / 1000;
  assert.equal(formatDrawTime(at, "en", "America/New_York"), "Sep 17");
  assert.equal(formatDrawTime(at, "en", "Asia/Tokyo"), "Sep 18");
  assert.equal(formatDrawTime(at, "fr", "Europe/Paris"), "18 sept.");
  assert.equal(
    formatDrawTime(
      Date.parse("2026-11-01T06:05:00Z") / 1000,
      "en",
      "America/New_York",
    ),
    "Nov 1",
  );
});

test("expected settlement uses 17:05 UTC across seasons without moving the protocol cutoff", () => {
  for (const day of ["2026-09-18", "2026-12-18"]) {
    const cutoff = Date.parse(`${day}T17:00:00Z`) / 1000;
    const expected = expectedDrawAt(cutoff);
    assert.equal(
      new Date(expected * 1000).toISOString(),
      `${day}T17:05:00.000Z`,
    );
    const time = (zone: string) =>
      new Intl.DateTimeFormat("en", {
        hour: "numeric",
        minute: "2-digit",
        hour12: false,
        timeZone: zone,
      }).format(expected * 1000);
    assert.equal(time("America/Cayman"), "12:05");
    assert.equal(
      time("America/New_York"),
      day.includes("09-") ? "13:05" : "12:05",
    );
    assert.equal(time("Asia/Tokyo"), "02:05");
    assert.equal(
      formatDrawTime(cutoff, "en", "Asia/Tokyo"),
      day.includes("09-") ? "Sep 19" : "Dec 19",
    );
    assert.deepEqual(countdown(expected, cutoff * 1000), ["00", "05", "00"]);
    assert.deepEqual(countdown(expected, (cutoff + 299) * 1000), [
      "00",
      "00",
      "01",
    ]);
    assert.deepEqual(countdown(expected, (cutoff + 301) * 1000), [
      "00",
      "00",
      "00",
    ]);
    const draw = {
      ...snapshot.current,
      closesAt: cutoff,
      settled: false,
      locked: false,
    };
    assert.equal(phase(draw, cutoff * 1000), "awaiting");
    assert.equal(draw.closesAt, cutoff);
  }
});

const wallet = "0x1111111111111111111111111111111111111111";
const win = {
  id: "1",
  wallet,
  round_id: "177",
  user_ticket_id: "7",
  claimed: true,
  claimed_tx_hash: "0x" + "ab".repeat(32),
  normals: [1, 2, 3, 4, 5],
  bonusball: 6,
  amount: { amount: "1800000", decimals: 6 },
};
test("claimed history groups overlapping pages exactly once and preserves cash amounts", () => {
  const values = parseIndexedWins(
    {
      data: [
        win,
        { ...win, id: "2", user_ticket_id: "8" },
        { ...win, id: "3", round_id: "176" },
      ],
    },
    { account: wallet, claimed: true },
  );
  const grouped = groupClaimedWins([...values, values[0]]);
  assert.deepEqual(
    grouped.map((g) => [g.draw, g.total, g.wins.length]),
    [
      ["177", 3600000n, 2],
      ["176", 1800000n, 1],
    ],
  );
  assert.equal(
    parseNextCursor({ has_more: true, next_cursor: "YWJj_-=" }),
    "YWJj_-=",
  );
  for (const bad of [null, {}, "https://evil.example", ""])
    assert.throws(() => parseNextCursor({ has_more: true, next_cursor: bad }));
});

test("result totals reject missing rounds, malformed tiers and unsafe integer counts", () => {
  const seed = JSON.parse(
    readFileSync(
      new URL("../src/resultsSnapshot.json", import.meta.url),
      "utf8",
    ),
  );
  const stats = summarizeResults(seed.rows);
  assert.equal(stats.through.id, "177");
  assert.equal(stats.jackpots, 1);
  assert.equal(stats.awarded, "592665053175");
  assert.equal(stats.largest?.id, "173");
  assert.throws(() =>
    summarizeResults(seed.rows.filter((r: { id: string }) => r.id !== "80")),
  );
  const round = {
    id: "178",
    status: "settled",
    ended_at: "2026-09-18T17:00:00Z",
    prize_tiers: Array.from({ length: 12 }, (_, i) => ({
      tier_id: i,
      normal_matches: Math.floor(i / 2),
      bonusball_match: i % 2 === 1,
      payout: { amount: "1000000", decimals: 6 },
      ticket_count: i === 11 ? 2 : 0,
    })),
  };
  const parsed = parseResultRounds({ data: [round] });
  assert.equal(summarizeResults(seed.rows, parsed.rows).jackpots, 3);
  assert.throws(() => parseResultRounds({ data: [round, round] }));
  assert.throws(() =>
    parseResultRounds({
      data: [{ ...round, prize_tiers: round.prize_tiers.slice(1) }],
    }),
  );
  assert.throws(() =>
    parseResultRounds({
      data: [
        {
          ...round,
          prize_tiers: round.prize_tiers.map((t) => ({
            ...t,
            ticket_count: Number.MAX_SAFE_INTEGER + 1,
          })),
        },
      ],
    }),
  );
});

test("indexed requests use bulk pages, serialize actual HTTP calls, and honor rate-limit cooldown", async (t) => {
  let active = 0,
    max = 0;
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    urls.push(String(input));
    active++;
    max = Math.max(max, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return Response.json({ data: [], has_more: false });
  });
  await Promise.all([
    readWalletWins(wallet),
    readRoundWins("177"),
    readRoundWins("176"),
  ]);
  assert.equal(max, 1);
  assert.ok(urls[0].includes("claimed=true&limit=100"));
  t.mock.method(globalThis, "fetch", async () => {
    urls.push("429");
    return new Response(null, {
      status: 429,
      headers: { "retry-after": "60" },
    });
  });
  await assert.rejects(readRoundWins("175"));
  const count = urls.length;
  await assert.rejects(readRoundWins("174"));
  assert.equal(
    urls.length,
    count,
    "cooldown must prevent an actual network start",
  );
});
