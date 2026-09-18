import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import * as native from "../src/native.ts";
import { JACKPOT, TICKET_NFT } from "../src/config.ts";
const code = "0x6000" as const,
  account = "0x1111111111111111111111111111111111111111";
mock.module("../src/native.ts", {
  namedExports: {
    ...native,
    REGISTRY: native.REGISTRY.map((r) => ({ ...r, hash: keccak256(code) })),
  },
});
const { readPlayerAccountAt } = await import("../src/playerReads.ts");
const { playerQueryOptions } = await import("../src/playerQuery.ts");
function fixture({
  scheme = 0n,
  pool = 100n,
  emergency = false,
  count = 2,
  owner = account,
  reorg = false,
  loser = false,
}: {
  scheme?: bigint;
  pool?: bigint;
  emergency?: boolean;
  count?: number;
  owner?: string;
  reorg?: boolean;
  loser?: boolean;
} = {}) {
  const calls: { functionName: string; blockNumber: bigint }[] = [];
  let blocks = 0;
  const client = {
    getBlock: async () => ({
      number: 123n,
      hash: "0x" + (reorg && blocks++ ? "22" : "11").repeat(32),
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    }),
    getCode: async () => code,
    readContract: async ({ functionName, args, blockNumber }: any) => {
      calls.push({ functionName, blockNumber });
      switch (functionName) {
        case "currentDrawingId":
          return 2n;
        case "emergencyMode":
          return emergency;
        case "balanceOf":
          return 20000000n;
        case "referralFees":
          return 1000000n;
        case "usdc":
          return native.USDC;
        case "jackpotNFT":
          return TICKET_NFT;
        case "jackpotLPManager":
          return native.LP_MANAGER;
        case "jackpot":
          return JACKPOT;
        case "getDrawingState":
          return {
            prizePool: 100000000n,
            ticketPrice: 1000000n,
            edgePerTicket: 0n,
            referralWinShare: 100000000000000000n,
            referralFee: 0n,
            globalTicketsBought: 1000n,
            lpEarnings: 0n,
            drawingTime: 1000000000n,
            winningTicket: args[0] === 1n ? 1n : 0n,
            ballMax: 30,
            bonusballMax: 10,
            payoutCalculator: "0x3333333333333333333333333333333333333333",
            jackpotLock: false,
          };
        case "getUserTickets":
          return args[1] === 2n
            ? []
            : Array.from({ length: count }, (_, i) => ({
                ticketId: BigInt(i + 1),
                ticket: {
                  drawingId: 1n,
                  packedTicket: 0n,
                  referralScheme: "0x" + scheme.toString(16).padStart(64, "0"),
                },
                normals: [1, 2, 3, 4, 5],
                bonusball: 6,
              }));
        case "getUnpackedTicket":
          return [[1, 2, 3, 4, 5], 6];
        case "getLPDrawingState":
          return {
            lpPoolTotal: pool,
            pendingDeposits: 0n,
            pendingWithdrawals: 0n,
          };
        case "getTicketTierIds":
          return args[0].map(() => (loser ? 12n : 11n));
        case "ownerOf":
          return owner;
        case "getTierPayout":
          return 10000001n;
        default:
          throw new Error(functionName);
      }
    },
  };
  return { client, calls };
}
test("player display deduplicates exact calculator payouts and applies existing referral formula at one block", async () => {
  for (const options of [
    { scheme: 0n, pool: 100n, expected: 18000002n },
    { scheme: 0n, pool: 0n, expected: 20000002n },
    { scheme: 0n, emergency: true, expected: 20000002n },
    { scheme: 1n, emergency: true, expected: 18000002n },
  ]) {
    const f = fixture(options),
      r = await readPlayerAccountAt(f.client as never, account);
    assert.equal(r.prizeTotal, options.expected);
    assert.equal(r.usdcBalance, 20000000n);
    assert.equal(
      f.calls.filter((c) => c.functionName === "getTierPayout").length,
      1,
    );
    assert.ok(f.calls.every((c) => c.blockNumber === 123n));
    assert.deepEqual(r.claimIds, [1n, 2n]);
  }
});
test("ownership inconsistency and changed blocks reject the whole observation", async () => {
  await assert.rejects(
    readPlayerAccountAt(
      fixture({ owner: "0x2222222222222222222222222222222222222222" })
        .client as never,
      account,
    ),
    /Ownership/,
  );
  await assert.rejects(
    readPlayerAccountAt(fixture({ reorg: true }).client as never, account),
    /changedBlock/,
  );
});
test("losers are zero only after verified settlement; no missing ticket is inferred claimed", async () => {
  const f = fixture({ loser: true }),
    r = await readPlayerAccountAt(f.client as never, account);
  assert.equal(r.prizeTotal, 0n);
  assert.deepEqual(r.claimIds, []);
  assert.equal(
    f.calls.filter((c) => c.functionName === "getTierPayout").length,
    0,
  );
  assert.ok(r.settledTickets.every((t) => !("claimed" in t)));
});
test("large wallets retain complete collections and balance with explicitly bounded prize enrichment", async () => {
  const r = await readPlayerAccountAt(
    fixture({ count: 601 }).client as never,
    account,
  );
  assert.equal(r.usdcBalance, 20000000n);
  assert.equal(r.allTickets.length, 601);
  assert.equal(r.settledTickets.length, 600);
  assert.equal(r.pricingComplete, false);
  assert.equal(r.unpricedTickets, 1);
});

test("player account uses actual viem multicall requests within a bounded wire budget", async (t) => {
  const { createPlayerRpcFixture } = await import("./fixtures/playerRpc.ts");
  const { fetchPlayerAccount } = await import("../src/chain.ts");
  const fixture = createPlayerRpcFixture();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) =>
      Response.json(fixture.respondBody(JSON.parse(String(init?.body)))),
  );
  const result = await fetchPlayerAccount(
    ["https://player-budget.example"],
    account,
  );
  assert.equal(result.prizeTotal, 10800000n);
  assert.equal(result.allTickets.length, 14);
  assert.equal(fixture.counters.multicalls, 5);
  assert.ok(
    fixture.counters.requests <= 11,
    `wire requests: ${fixture.counters.requests}`,
  );
  assert.equal(fixture.counters.functions.getTierPayout, 6);
  assert.equal(fixture.counters.deniedWrites, 0);
});

test("balance stays unknown until a chain read, retains observed funds on failure, and isolates account changes", async (t) => {
  const { createPlayerRpcFixture, alternateAddress } = await import(
    "./fixtures/playerRpc.ts"
  );
  let fixture = createPlayerRpcFixture();
  let fail = false,
    hold = true;
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      if (fail) throw new Error("offline");
      if (hold) {
        started();
        await gate;
      }
      return Response.json(fixture.respondBody(JSON.parse(String(init?.body))));
    },
  );
  const urls = ["https://balance-states.example"];
  const client = new QueryClient();
  const observer = new QueryObserver(client, playerQueryOptions(urls, account));
  const observations: Array<bigint | undefined> = [];
  const stop = observer.subscribe((result) =>
    observations.push(result.data?.usdcBalance),
  );
  try {
    await requested;
    assert.equal(observer.getCurrentResult().data, undefined);
    assert.ok(observations.every((value) => value === undefined));
    hold = false;
    release();
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data?.usdcBalance, 25_000_000n);
    fail = true;
    await observer.refetch();
    assert.equal(observer.getCurrentResult().isError, true);
    assert.equal(observer.getCurrentResult().data?.usdcBalance, 25_000_000n);
    assert.ok(
      observations.every(
        (value) => value === undefined || value === 25_000_000n,
      ),
    );
    observer.setOptions(playerQueryOptions(urls, alternateAddress));
    assert.equal(observer.getCurrentResult().data, undefined);
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data, undefined);
    fail = false;
    fixture = createPlayerRpcFixture({
      account: alternateAddress,
      usdcBalance: 0n,
    });
    await observer.refetch();
    assert.equal(observer.getCurrentResult().data?.account, alternateAddress);
    assert.equal(observer.getCurrentResult().data?.usdcBalance, 0n);
    assert.ok(fixture.counters.functions.balanceOf > 0);
    observer.setOptions(playerQueryOptions(urls, undefined));
    assert.equal(observer.getCurrentResult().data, undefined);
  } finally {
    release();
    stop();
    client.clear();
  }
});
