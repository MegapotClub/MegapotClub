import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { mainMatches, ticketsByMatches } from "../src/ticketDisplay.ts";
import { rankRecentWins, readRecentWins } from "../src/recentWins.ts";
import { wholeDollarLowerBound } from "../src/resultStats.ts";
import type { Draw, TicketRecord } from "../src/model.ts";
import { parseIndexedPlayers, type IndexedPlayer } from "../src/megapotApi.ts";

const draw: Draw = {
  id: "900",
  prizePool: "1",
  ticketPrice: "1000000",
  ticketCount: "20",
  closesAt: 1_000,
  locked: false,
  settled: true,
  ballMax: 30,
  bonusMax: 10,
  result: { numbers: [1, 2, 3, 4, 5], bonus: 7 },
};
const win = (id: string, _round: string, amount: string): IndexedPlayer => ({
  wallet: `0x${BigInt(id).toString(16).padStart(40, "0")}`,
  total_ticket_count: 20,
  winning_ticket_count: 2,
  total_payout: { amount, decimals: 6 },
});

test("owned ticket ranking happens across the entire draw before paging and keeps the observation immutable", () => {
  const tickets: TicketRecord[] = Array.from({ length: 15 }, (_, i) => ({
    id: String(i + 1),
    drawId: draw.id,
    numbers:
      i === 14 ? [1, 2, 3, 4, 5] : i === 13 ? [1, 2, 3, 8, 9] : [1, 6, 7, 8, 9],
    bonus: i === 12 ? 7 : 1,
  }));
  const original = structuredClone(tickets);
  const firstPage = ticketsByMatches(tickets, draw).slice(0, 12);
  assert.deepEqual(
    firstPage.slice(0, 3).map((ticket) => ticket.id),
    ["15", "14", "13"],
  );
  assert.deepEqual(
    firstPage.slice(0, 3).map((ticket) => mainMatches(ticket, draw)),
    [5, 3, 1],
  );
  assert.deepEqual(tickets, original);
  assert.deepEqual(
    ticketsByMatches(tickets, { ...draw, settled: false, result: null }),
    original,
  );
});

test("recent ranking uses the whole fourteen-day window, exact amounts, deduplication and no future draws", () => {
  const now = 2_000_000_000,
    day = 86_400;
  const rounds = Array.from({ length: 14 }, (_, i) => ({
    id: String(900 + i),
    time: now - i * day,
    wins: [win(String(100 + i), String(900 + i), String((i + 1) * 1_000_000))],
  }));
  rounds[13].wins.push(win("888", "913", "9007199254740993000000"));
  rounds.push(rounds[13]);
  rounds.push({
    id: "800",
    time: now - 14 * day - 1,
    wins: [win("1", "800", "999999999999999999999999999")],
  });
  rounds.push({
    id: "999",
    time: now + 1,
    wins: [win("2", "999", "999999999999999999999999999")],
  });
  const ranking = rankRecentWins(rounds, now);
  assert.deepEqual(
    ranking.data.map((item) => BigInt(item.wallet).toString()),
    ["888", "113", "112", "111", "110"],
  );
  assert.equal(ranking.windowStart, now - 14 * day);
  assert.equal(wholeDollarLowerBound("592665999999"), "592665000000");
  assert.equal(wholeDollarLowerBound("999999"), "0");
  assert.throws(() =>
    parseIndexedPlayers({ data: [win("1", "900", "1"), win("1", "900", "1")] }),
  );
  assert.throws(() =>
    parseIndexedPlayers({
      data: [{ ...win("1", "900", "1"), winning_ticket_count: 21 }],
    }),
  );
  assert.throws(() =>
    parseIndexedPlayers({
      data: [
        {
          ...win("1", "900", "1"),
          total_payout: { amount: "1", decimals: 18 },
        },
      ],
    }),
  );
});

test("complete recent rankings reuse settled reads and an upstream failure preserves the previous query result", async (t) => {
  const calls: string[] = [];
  let fail = false;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (fail) return new Response("", { status: 500 });
    const round = url.match(/rounds\/(\d+)/)![1];
    return Response.json({
      data: [win(round, round, "1000000")],
      has_more: false,
      next_cursor: null,
    });
  });
  const now = 2_000_000_000;
  const rows = [900, 901].map((id) => ({
    id: String(id),
    time: now - 100,
    jackpots: 0,
    jackpot: "0",
    awarded: "1000000",
  }));
  const first = await readRecentWins(rows, now);
  await readRecentWins(rows, now);
  assert.equal(calls.length, 2);
  await readRecentWins(rows, now + 901);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url.endsWith("/players?limit=5")));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = ["recent-test"];
  client.setQueryData(key, first);
  fail = true;
  await assert.rejects(
    client.fetchQuery({
      queryKey: key,
      queryFn: () => readRecentWins([...rows, { ...rows[0], id: "902" }], now),
    }),
  );
  assert.deepEqual(client.getQueryData(key), first);
  client.clear();
});
