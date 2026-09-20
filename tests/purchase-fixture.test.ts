import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import {
  createPlayerRpcFixture,
  fixtureAddress,
  qaAddresses,
  qaPlayerAbi,
  qaCodeHash,
} from "./fixtures/playerRpc.ts";
import { PURCHASE_SOURCE, REGISTRY, reviewAction } from "../src/native.ts";
import { claimReceipt } from "../src/purchaseReceipt.ts";
import type { TransactionReceipt } from "viem";
const referrer = "0x2222222222222222222222222222222222222222";
test("the real viem client reviews fixture purchases and claims through multicall", async () => {
  const fixture = createPlayerRpcFixture({ rankedTickets: true });
  const originalFetch = globalThis.fetch;
  const pins = REGISTRY as unknown as { hash: string }[];
  const originalPins = pins.map((p) => p.hash);
  for (const pin of pins) pin.hash = qaCodeHash;
  globalThis.fetch = async (_input, init) =>
    Response.json(fixture.respondBody(JSON.parse(String(init?.body))));
  try {
    const purchase = await reviewAction(
      ["https://base-rpc.publicnode.com"],
      fixtureAddress,
      {
        kind: "purchase",
        recipient: fixtureAddress,
        referrer,
        tickets: [{ numbers: [1, 2, 3, 4, 5], bonus: 6 }],
        unitPrice: 1000000n,
        drawId: 175n,
      },
    );
    assert.deepEqual(
      purchase.calls.map((c) => c.kind),
      ["approve", "purchase"],
    );
    const claim = await reviewAction(
      ["https://base-rpc.publicnode.com"],
      fixtureAddress,
      { kind: "claim", ids: [174001n, 174002n] },
    );
    assert.equal(claim.amount, 7200000n);
    assert.equal(fixture.counters.functions.getEthBalance > 0, true);
    assert.equal(fixture.counters.deniedWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
    pins.forEach((p, i) => {
      p.hash = originalPins[i];
    });
  }
});
test("synthetic checkout approves, records the actual purchase, and exposes minted tickets", () => {
  const fixture = createPlayerRpcFixture();
  const approval = encodeFunctionData({
    abi: qaPlayerAbi,
    functionName: "approve",
    args: [qaAddresses.jackpot, 10000000n],
  });
  fixture.simulateSend(
    { from: fixtureAddress, to: qaAddresses.usdc, data: approval },
    "confirmed",
  );
  const data = encodeFunctionData({
    abi: qaPlayerAbi,
    functionName: "buyTickets",
    args: [
      Array.from({ length: 10 }, () => ({
        normals: [1, 2, 3, 4, 5],
        bonusball: 6,
      })),
      fixtureAddress,
      [referrer],
      [10n ** 18n],
      PURCHASE_SOURCE,
    ],
  });
  const hash = fixture.simulateSend(
    { from: fixtureAddress, to: qaAddresses.jackpot, data },
    "confirmed",
  );
  const receipt = fixture.respond({
    id: 1,
    method: "eth_getTransactionReceipt",
    params: [hash],
  }).result as { status: string; logs: unknown[] };
  assert.equal(receipt.status, "0x1");
  assert.equal(receipt.logs.length, 11);
  const output = fixture.respond({
    id: 2,
    method: "eth_call",
    params: [
      {
        to: qaAddresses.jackpot,
        data: encodeFunctionData({
          abi: qaPlayerAbi,
          functionName: "getUserTickets",
          args: [fixtureAddress, fixture.currentDraw],
        }),
      },
    ],
  });
  const tickets = decodeFunctionResult({
    abi: qaPlayerAbi,
    functionName: "getUserTickets",
    data: output.result as Hex,
  });
  assert.equal(tickets.length, 12);
  assert.deepEqual(
    tickets.slice(2).map((t) => t.normals),
    Array.from({ length: 10 }, () => [1, 2, 3, 4, 5]),
  );
  assert.equal(fixture.counters.deniedWrites, 0);
  assert.equal(
    fixture.respond({ id: 3, method: "eth_sendTransaction", params: [] }).error
      ?.code,
    -32000,
  );
});

test("synthetic claims pay the receipt amount, burn claimed tickets and clear referral fees", () => {
  const fixture = createPlayerRpcFixture({ rankedTickets: true });
  const read = (
    name: "balanceOf" | "getUserTickets" | "referralFees",
    args: readonly unknown[],
  ) => {
    const result = fixture.respond({
      id: 1,
      method: "eth_call",
      params: [
        {
          to: name === "balanceOf" ? qaAddresses.usdc : qaAddresses.jackpot,
          data: encodeFunctionData({
            abi: qaPlayerAbi,
            functionName: name,
            args,
          } as never),
        },
      ],
    });
    assert.equal(result.error, undefined);
    return decodeFunctionResult({
      abi: qaPlayerAbi,
      functionName: name,
      data: result.result as Hex,
    });
  };
  const ids = [174001n, 174002n];
  const data = encodeFunctionData({
    abi: qaPlayerAbi,
    functionName: "claimWinnings",
    args: [ids],
  });
  const hash = fixture.simulateSend(
    { from: fixtureAddress, to: qaAddresses.jackpot, data },
    "confirmed",
  );
  const receipt = fixture.respond({
    id: 2,
    method: "eth_getTransactionReceipt",
    params: [hash],
  }).result as TransactionReceipt;
  assert.deepEqual(claimReceipt(receipt.logs, fixtureAddress), {
    amount: "7200000",
    ticketIds: ids.map(String),
  });
  assert.equal(read("balanceOf", [fixtureAddress]), 32200000n);
  assert.deepEqual(read("getUserTickets", [fixtureAddress, 174n]), []);
  assert.throws(
    () =>
      fixture.simulateSend(
        { from: fixtureAddress, to: qaAddresses.jackpot, data },
        "confirmed",
      ),
    /burned/,
  );
  fixture.simulateSend(
    {
      from: fixtureAddress,
      to: qaAddresses.jackpot,
      data: encodeFunctionData({
        abi: qaPlayerAbi,
        functionName: "claimReferralFees",
      }),
    },
    "confirmed",
  );
  assert.equal(read("referralFees", [fixtureAddress]), 0n);
  assert.equal(read("balanceOf", [fixtureAddress]), 35200000n);
});
