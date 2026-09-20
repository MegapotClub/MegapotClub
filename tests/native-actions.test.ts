import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, parseAbi } from "viem";
import {
  actionCalls,
  amountUSDC,
  atNativeEndpoint,
  ticketIds,
  USDC,
  LP_MANAGER,
  SUBSCRIPTION,
  BATCH,
} from "../src/native.ts";
import { JACKPOT } from "../src/config.ts";
import {
  CLUB_REFERRER,
  PURCHASE_SOURCE,
  purchaseTickets,
} from "../src/native.ts";

test("USDC amounts preserve six-decimal integer precision and reject truncation or exponent syntax", () => {
  assert.equal(amountUSDC("123456789012345.123456"), 123456789012345123456n);
  assert.equal(amountUSDC("0.000001"), 1n);
  for (const s of [
    "0",
    "-1",
    "1e6",
    "01",
    "1.0000001",
    "NaN",
    "Infinity",
    " 10",
    "10 ",
    ".5",
  ])
    assert.throws(() => amountUSDC(s));
});
test("every uint256 ticket ID, including 78-digit hashes, is supported without numeric coercion", () => {
  const max = (1n << 256n) - 1n;
  assert.deepEqual(ticketIds(`${max}, 1`), [max, 1n]);
  for (const text of [
    String(max + 1n),
    "0",
    "1,1",
    "-1",
    "",
    "1e10",
    Array.from({ length: 31 }, (_, i) => i + 1).join(","),
  ])
    assert.throws(() => ticketIds(text));
});
test("deposit authorization is exact and names Jackpot, not LPManager", () => {
  const calls = actionCalls({ kind: "deposit", amount: 20_000_001n }, 0n);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to, USDC);
  const decoded = decodeFunctionData({
    abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
    data: calls[0].data,
  });
  assert.equal(decoded.args[0].toLowerCase(), JACKPOT.toLowerCase());
  assert.notEqual(decoded.args[0].toLowerCase(), LP_MANAGER.toLowerCase());
  assert.equal(decoded.args[1], 20_000_001n);
  assert.equal(calls[1].to, JACKPOT);
  assert.equal(calls[1].data.slice(0, 10), "0xb41b582c");
  assert.equal(
    actionCalls({ kind: "deposit", amount: 20_000_001n }, 20_000_001n).length,
    1,
  );
});
test("all fixed-target actions have native selectors and zero Ether value", () => {
  const cases = [
    [{ kind: "withdraw", shares: 123n }, JACKPOT, "0x7e108d52"],
    [{ kind: "finalize" }, JACKPOT, "0x30fcc737"],
    [{ kind: "referral" }, JACKPOT, "0x83a84ba9"],
    [{ kind: "claim", ids: [1n] }, JACKPOT, "0x1bf0ade0"],
    [{ kind: "refund", ids: [1n] }, JACKPOT, "0xcb690d71"],
    [{ kind: "cancelSubscription" }, SUBSCRIPTION, "0x24e9edb0"],
    [{ kind: "cancelBatch" }, BATCH, "0xf2745456"],
    [{ kind: "emergencyExit" }, JACKPOT, "0x78417398"],
    [{ kind: "revoke" }, USDC, "0x095ea7b3"],
  ] as const;
  for (const [action, to, selector] of cases) {
    const calls = actionCalls(
      action.kind === "claim" || action.kind === "refund"
        ? { ...action, ids: [...action.ids] }
        : action,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, to);
    assert.equal(calls[0].value, 0n);
    assert.equal(calls[0].data.slice(0, 10), selector);
  }
  assert.throws(() => actionCalls({ kind: "withdraw", shares: 0n }));
});
test("fallback validates every endpoint and restarts a complete observation", async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    seen.push(`${url}:${request.method}`);
    if (String(url).includes("one") && request.method !== "eth_chainId")
      throw new Error("connection lost");
    const result = String(url).includes("two") ? "0x1" : "0x2105";
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  let observations = 0;
  await assert.rejects(
    atNativeEndpoint(
      ["https://one.example/rpc", "https://two.example/rpc"],
      async (c) => {
        observations++;
        return c.getBlockNumber();
      },
    ),
    /wrongChain/,
  );
  assert.equal(observations, 1);
  assert.deepEqual(seen, [
    "https://one.example/rpc:eth_chainId",
    "https://one.example/rpc:eth_blockNumber",
    "https://two.example/rpc:eth_chainId",
  ]);
});

const buyAbi = parseAbi([
  "function buyTickets((uint8[] normals, uint8 bonusball)[], address, address[], uint256[], bytes32) returns (uint256[])",
  "function approve(address,uint256) returns (bool)",
]);
const buyer = "0x1111111111111111111111111111111111111111" as const;
const order = {
  kind: "purchase" as const,
  tickets: [
    { numbers: [5, 1, 30, 22, 9], bonus: 10 },
    { numbers: [1, 2, 3, 4, 5], bonus: 1 },
  ],
  recipient: buyer,
  referrer: CLUB_REFERRER,
  drawId: 178n,
  unitPrice: 1_000_001n,
};
test("a purchase approves the exact order total for Jackpot, then buys the same tickets for the buyer with the Club referrer", () => {
  const calls = actionCalls(order, 0n);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].to, USDC);
  assert.equal(calls[0].kind, "approve");
  const approval = decodeFunctionData({ abi: buyAbi, data: calls[0].data });
  assert.equal(approval.functionName, "approve");
  assert.equal(approval.args[0], JACKPOT);
  assert.equal(approval.args[1], 2_000_002n);
  assert.equal(calls[1].to, JACKPOT);
  assert.equal(calls[1].kind, "purchase");
  assert.equal(calls[1].value, 0n);
  assert.equal(calls[1].data.slice(0, 10), "0xde88c28a");
  const buy = decodeFunctionData({ abi: buyAbi, data: calls[1].data });
  assert.equal(buy.functionName, "buyTickets");
  assert.deepEqual(buy.args[0], [
    { normals: [1, 5, 9, 22, 30], bonusball: 10 },
    { normals: [1, 2, 3, 4, 5], bonusball: 1 },
  ]);
  assert.equal(buy.args[1], buyer);
  assert.deepEqual(buy.args[2], [CLUB_REFERRER]);
  assert.equal(CLUB_REFERRER, "0xd560dFDC6838b9f11C77177f940592A2ba230155");
  assert.deepEqual(buy.args[3], [10n ** 18n]);
  assert.equal(buy.args[4], PURCHASE_SOURCE);
  assert.equal(buy.args[4].length, 66);
  const covered = actionCalls(order, 2_000_002n);
  assert.equal(covered.length, 1);
  assert.equal(covered[0].data, calls[1].data);
  assert.equal(actionCalls(order, 2_000_001n).length, 2);
});
test("purchase orders are bounded and reject malformed tickets, prices and recipients", () => {
  const ticket = { numbers: [1, 2, 3, 4, 5], bonus: 1 };
  assert.equal(purchaseTickets(Array(100).fill(ticket)).length, 100);
  for (const tickets of [
    [],
    Array(101).fill(ticket),
    [{ numbers: [1, 2, 3, 4], bonus: 1 }],
    [{ numbers: [1, 2, 3, 4, 4], bonus: 1 }],
    [{ numbers: [1, 2, 3, 4, 31], bonus: 1 }],
    [{ numbers: [1, 2, 3, 4, 5], bonus: 0 }],
    [{ numbers: [1, 2, 3, 4, 5], bonus: 11 }],
    [{ numbers: [0, 2, 3, 4, 5], bonus: 1 }],
    [{ numbers: [1.5, 2, 3, 4, 5], bonus: 1 }],
  ])
    assert.throws(
      () => purchaseTickets(tickets, 30, 10),
      `${JSON.stringify(tickets).slice(0, 60)}`,
    );
  assert.throws(() => actionCalls({ ...order, unitPrice: 0n }));
  assert.throws(() => actionCalls({ ...order, recipient: "0x1234" as never }));
  assert.throws(() =>
    actionCalls({
      ...order,
      tickets: [{ numbers: [1, 2, 3, 4, 5], bonus: 256 }],
    }),
  );
});
