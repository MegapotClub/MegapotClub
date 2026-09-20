import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import {
  createPlayerRpcFixture,
  fixtureAddress,
  qaAddresses,
  qaPlayerAbi,
} from "./fixtures/playerRpc.ts";
import { PURCHASE_SOURCE } from "../src/native.ts";
const referrer = "0x2222222222222222222222222222222222222222";
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
