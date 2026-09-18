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
test("all non-purchase actions have fixed targets, native selectors and zero Ether value", () => {
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
