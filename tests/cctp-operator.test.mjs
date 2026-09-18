import test from "node:test";
import assert from "node:assert/strict";
import { parseAbi, decodeFunctionData } from "viem";
import { relayCall, inboxCall } from "../scripts/cctp-relay.mjs";
const target = "0x1111111111111111111111111111111111111111";
const abi = parseAbi([
  "function relayAsset(bytes,bytes)",
  "function relayControl(bytes,bytes)",
  "function returnCash(uint256,uint256)",
  "function announceStop()",
  "function invest(uint256)",
]);
test("operator relay selects only the fixed transport selectors and rejects malformed proof envelopes", () => {
  for (const [bytes, name] of [
    [632, "relayAsset"],
    [404, "relayControl"],
  ]) {
    const message = "0x" + "ab".repeat(bytes),
      attestation = "0x" + "cd".repeat(65),
      call = relayCall(abi, target, message, attestation);
    assert.equal(call.to, target);
    assert.equal(call.value, "0");
    assert.equal(
      decodeFunctionData({ abi, data: call.data }).functionName,
      name,
    );
  }
  for (const [message, proof] of [
    ["0x1234", "0x" + "cd".repeat(65)],
    ["0x" + "ab".repeat(632), "PENDING"],
    ["0x" + "ab".repeat(632), "0x123"],
  ])
    assert.throws(() => relayCall(abi, target, message, proof));
});
test("inbox progress cannot introduce an arbitrary call, recipient or attacker-selected return chunk", () => {
  const call = inboxCall(abi, target, "returnCash", "17");
  assert.deepEqual(decodeFunctionData({ abi, data: call.data }).args, [
    17n,
    2n ** 256n - 1n,
  ]);
  for (const op of ["transfer", "approve", "delegatecall"])
    assert.throws(() => inboxCall(abi, target, op, "1"));
  for (const id of ["0", "-1", "1e6", (2n ** 256n).toString()])
    assert.throws(() => inboxCall(abi, target, "invest", id));
  assert.equal(
    decodeFunctionData({
      abi,
      data: inboxCall(abi, target, "announceStop").data,
    }).functionName,
    "announceStop",
  );
});
