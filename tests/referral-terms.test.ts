import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, type Hex } from "viem";
import { readReferralTerms } from "../src/native.ts";
import {
  createPlayerRpcFixture,
  qaPlayerAbi,
  type RpcRequest,
} from "./fixtures/playerRpc.ts";

test("referral example reads the expected jackpot at one block, never ten percent of the pool", async (t) => {
  const fixture = createPlayerRpcFixture({ prizePool: 1_133_000_000_000n });
  const reads: { name: string; args: unknown; block: unknown }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcRequest | RpcRequest[];
      for (const request of Array.isArray(body) ? body : [body]) {
        if (request.method === "eth_call") {
          const call = request.params![0] as { data: Hex };
          const inspect = (data: Hex) => {
            const decoded = decodeFunctionData({ abi: qaPlayerAbi, data });
            if (decoded.functionName === "aggregate3")
              for (const inner of decoded.args[0]) inspect(inner.callData);
            else
              reads.push({
                name: decoded.functionName,
                args: decoded.args,
                block: request.params![1],
              });
          };
          inspect(call.data);
        }
      }
      return Response.json(fixture.respondBody(body));
    },
  );
  const terms = await readReferralTerms(["https://referral-terms.example"]);
  assert.equal(terms.jackpotGross, 220_000_000_000n);
  assert.equal(terms.jackpotReferralReward, 22_000_000_000n);
  assert.notEqual(terms.jackpotReferralReward, 113_300_000_000n);
  assert.deepEqual(
    reads.map((r) => r.name),
    ["currentDrawingId", "getDrawingState", "getExpectedDrawingTierPayouts"],
  );
  assert.equal(new Set(reads.map((r) => r.block)).size, 1);
  assert.equal(reads[0].block, `0x${fixture.blockNumber.toString(16)}`);
  assert.deepEqual(reads[2].args, [
    fixture.currentDraw,
    1_133_000_000_000n,
    30,
    10,
  ]);
  assert.equal(fixture.counters.deniedWrites, 0);
});
