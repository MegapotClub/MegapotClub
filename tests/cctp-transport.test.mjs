import test from "node:test";
import assert from "node:assert/strict";
import {
  getContractAddress,
  keccak256,
  padHex,
  toHex,
  encodeAbiParameters,
} from "viem";
import { createAddressFromString } from "@ethereumjs/util";
import { compileContracts } from "../scripts/compile-contracts.mjs";
import { createHarness } from "./contracts/evm.mjs";
const compiled = compileContracts({ mocks: true });
const U = 1_000_000n,
  P = 10n ** 18n;
function replace(hex, byteOffset, value) {
  return (
    hex.slice(0, 2 + byteOffset * 2) +
    value.slice(2) +
    hex.slice(2 + byteOffset * 2 + value.length - 2)
  );
}
let nonce = 1n;
function attest(original) {
  const message = replace(
    replace(original, 12, toHex(nonce++, { size: 32 })),
    144,
    toHex(2000, { size: 4 }),
  );
  return {
    message,
    attestation: encodeAbiParameters(
      [{ type: "bytes32" }],
      [keccak256(message)],
    ),
  };
}
async function fixture() {
  const h = await createHarness(compiled);
  const baseToken = await h.deploy("MockToken", [6]),
    l1Token = await h.deploy("MockToken", [6]);
  const aave = await h.deploy("MockAave", [baseToken.address]);
  const native = await h.deploy("MockNative", [baseToken.address]);
  const service = await h.deploy("BaseUsdcVault", [
    baseToken.address,
    native.address,
    native.address,
    aave.address,
    await aave.read("aToken"),
    1n,
  ]);
  const l1Transmitter = await h.deploy("MockTransmitter", [0, l1Token.address]),
    baseTransmitter = await h.deploy("MockTransmitter", [6, baseToken.address]);
  const l1Messenger = await h.deploy("MockMessenger", [l1Transmitter.address]),
    baseMessenger = await h.deploy("MockMessenger", [baseTransmitter.address]);
  await l1Transmitter.call("setMessenger", [l1Messenger.address]);
  await baseTransmitter.call("setMessenger", [baseMessenger.address]);
  await l1Messenger.call("setRemote", [
    padHex(baseMessenger.address, { size: 32 }),
  ]);
  await baseMessenger.call("setRemote", [
    padHex(l1Messenger.address, { size: 32 }),
  ]);
  const account = await h.vm.stateManager.getAccount(
    createAddressFromString(h.alice),
  );
  const l1Address = getContractAddress({ from: h.alice, nonce: account.nonce });
  const baseAddress = getContractAddress({
    from: h.alice,
    nonce: account.nonce + 1n,
  });
  const l1 = await h.deploy("EthereumUsdcVault", [
    [
      l1Token.address,
      l1Messenger.address,
      l1Transmitter.address,
      baseAddress,
      padHex(baseToken.address, { size: 32 }),
      padHex(baseMessenger.address, { size: 32 }),
      0,
      6,
      1n,
      100n * U,
    ],
  ]);
  const inbox = await h.deploy("BaseInbox", [
    [
      baseToken.address,
      baseMessenger.address,
      baseTransmitter.address,
      l1Address,
      padHex(l1Token.address, { size: 32 }),
      padHex(l1Messenger.address, { size: 32 }),
      6,
      0,
      1n,
      100n * U,
    ],
    service.address,
  ]);
  assert.equal(l1.address.toLowerCase(), l1Address.toLowerCase());
  assert.equal(inbox.address.toLowerCase(), baseAddress.toLowerCase());
  await l1Token.call("mint", [h.alice, 1000n * U]);
  await l1Token.call("approve", [l1.address, 1000n * U]);
  async function relay(from, to, index, asset = false) {
    const a = attest(await from.read("sent", [BigInt(index)]));
    await to.call(
      asset ? "relayAsset" : "relayControl",
      [a.message, a.attestation],
      h.keeper,
    );
    return a;
  }
  return {
    ...h,
    baseToken,
    l1Token,
    aave,
    native,
    service,
    l1Transmitter,
    baseTransmitter,
    l1Messenger,
    baseMessenger,
    l1,
    inbox,
    relay,
  };
}
test("CCTP arrival authenticates every route identity, finality, economic replay and exact mint", async () => {
  const h = await fixture();
  const {
    l1,
    inbox,
    l1Transmitter,
    baseTransmitter,
    baseToken,
    alice,
    attacker,
  } = h;
  await l1.call("requestDeposit", [100n * U, alice]);
  await l1.call("bridgeDeposit", [1n]);
  const original = await l1Transmitter.read("sent", [0n]);
  const badFields = [
    [0, toHex(2, { size: 4 })],
    [4, toHex(99, { size: 4 })],
    [8, toHex(99, { size: 4 })],
    [44, padHex(attacker, { size: 32 })],
    [76, padHex(attacker, { size: 32 })],
    [108, padHex(attacker, { size: 32 })],
    [140, toHex(1000, { size: 4 })],
    [152, padHex(attacker, { size: 32 })],
    [184, padHex(attacker, { size: 32 })],
    [248, padHex(attacker, { size: 32 })],
    [280, toHex(1n, { size: 32 })],
    [312, toHex(1n, { size: 32 })],
  ];
  for (const [offset, value] of badFields) {
    const a = attest(replace(original, offset, value));
    await assert.rejects(
      inbox.call("relayAsset", [a.message, a.attestation]),
      /InvalidMessage/,
    );
  }
  const lowFinality = attest(original);
  lowFinality.message = replace(
    lowFinality.message,
    144,
    toHex(1999, { size: 4 }),
  );
  await assert.rejects(
    inbox.call("relayAsset", [lowFinality.message, lowFinality.attestation]),
    /InvalidMessage/,
  );
  const valid = attest(original);
  await baseToken.call("mint", [inbox.address, 13n * U]);
  await baseTransmitter.call("setShortMint", [true]);
  await assert.rejects(
    inbox.call("relayAsset", [valid.message, valid.attestation]),
    /InexactTransport/,
  );
  assert.equal(await baseToken.read("balanceOf", [inbox.address]), 13n * U);
  assert.equal(
    await baseTransmitter.read("used", [`0x${valid.message.slice(26, 90)}`]),
    false,
  );
  await baseTransmitter.call("setShortMint", [false]);
  await inbox.call("relayAsset", [valid.message, valid.attestation]);
  assert.equal(await inbox.read("reservedCash"), 100n * U);
  await assert.rejects(
    inbox.call("relayAsset", [valid.message, valid.attestation]),
    /Replay/,
  );
  const secondNonce = attest(original);
  await assert.rejects(
    inbox.call("relayAsset", [secondNonce.message, secondNonce.attestation]),
    /Replay/,
  );
});
test("full L1 lifecycle: transfer receipts, burn, exit, partial returns and out-of-order closure", async () => {
  const h = await fixture();
  const {
    l1,
    inbox,
    l1Token,
    l1Transmitter,
    baseTransmitter,
    service,
    native,
    relay,
    alice,
    bob,
  } = h;
  await l1.call("requestDeposit", [100n * U, alice]);
  await l1.call("bridgeDeposit", [1n]);
  await relay(l1Transmitter, inbox, 0, true);
  await inbox.call("invest", [1n]);
  await service.call("processDeposits", [64n, 100n * U]);
  await native.call("settle", [P]);
  await inbox.call("claimDepositLot", [1n]);
  await inbox.call("closeOperation", [1n]);
  await relay(baseTransmitter, l1, 1);
  await assert.rejects(l1.call("finalizeOperation", [1n]), /WrongState/);
  await relay(baseTransmitter, l1, 0);
  await l1.call("finalizeOperation", [1n]);
  await l1.call("claimShares", [1n, alice]);
  await l1.call("transfer", [bob, 100n * U]);
  await l1.call("requestRedeem", [100n * U, bob], bob);
  assert.equal(await l1.read("totalSupply"), 0n);
  await relay(l1Transmitter, inbox, 1);
  await inbox.call("startRedeem", [2n]);
  await service.call("processRedeems", [64n, 100n * U]);
  await native.call("settle", [(11n * P) / 10n]);
  await inbox.call("claimExitLot", [1n]);
  await inbox.call("closeRedeem", [1n]);
  await assert.rejects(inbox.call("returnCash", [2n, 1n]), /WrongState/);
  await inbox.call("returnCash", [2n, 100n * U]);
  await inbox.call("returnCash", [2n, 1000n * U]);
  await inbox.call("closeOperation", [2n]);
  await relay(baseTransmitter, l1, 4);
  await assert.rejects(l1.call("finalizeOperation", [2n]), /WrongState/);
  await relay(baseTransmitter, l1, 3, true);
  await assert.rejects(l1.call("finalizeOperation", [2n]), /WrongState/);
  await relay(baseTransmitter, l1, 2, true);
  await l1.call("finalizeOperation", [2n]);
  assert.equal(await l1.call("claimCash", [2n, bob], bob), 110n * U);
  assert.equal(await l1Token.read("balanceOf", [bob]), 110n * U);
  assert.equal(await l1.read("exposureClosed", [bob]), true);
  assert.equal(await inbox.read("backingShares"), 0n);
  assert.equal(await inbox.read("reservedCash"), 0n);
});
test("exit delivered before deposit keeps authentic arrival receivable and returns it without investing", async () => {
  const { l1, inbox, l1Transmitter, baseTransmitter, relay, alice, service } =
    await fixture();
  await l1.call("requestDeposit", [50n * U, alice]);
  await l1.call("bridgeDeposit", [1n]);
  await l1.call("requestExit", [1n]);
  await relay(l1Transmitter, inbox, 1);
  await relay(l1Transmitter, inbox, 0, true);
  await assert.rejects(inbox.call("invest", [1n]), /WrongState/);
  await inbox.call("returnCash", [1n, 50n * U]);
  await inbox.call("closeOperation", [1n]);
  await relay(baseTransmitter, l1, 1);
  await relay(baseTransmitter, l1, 0, true);
  await l1.call("finalizeOperation", [1n]);
  assert.equal(await l1.call("claimCash", [1n, alice]), 50n * U);
  assert.equal(await service.read("nextDeposit"), 1n);
});
test("capacity and Aave failure cannot prevent received ownership; waiting cancellation recovers yield", async () => {
  const {
    l1,
    inbox,
    l1Transmitter,
    baseTransmitter,
    relay,
    alice,
    native,
    aave,
    contract,
    service,
  } = await fixture();
  await native.call("setCapacity", [0n, 0n]);
  await aave.call("setIlliquid", [true]);
  await l1.call("requestDeposit", [100n * U, alice]);
  await l1.call("bridgeDeposit", [1n]);
  await relay(l1Transmitter, inbox, 0, true);
  await inbox.call("invest", [1n]);
  await service.call("processDeposits", [64n, 100n * U]);
  await l1.call("requestExit", [1n]);
  await relay(l1Transmitter, inbox, 1);
  await inbox.call("cancelWaiting", [1n]);
  await assert.rejects(inbox.call("retrieveWaiting", [1n]));
  const aToken = contract("MockAToken", await aave.read("aToken"));
  await aToken.call("setIndex", [12n * 10n ** 26n]);
  await aave.call("setIlliquid", [false]);
  await inbox.call("retrieveWaiting", [1n]);
  await inbox.call("returnCash", [1n, 1000n * U]);
  await inbox.call("returnCash", [1n, 1000n * U]);
  await inbox.call("closeOperation", [1n]);
  await relay(baseTransmitter, l1, 0, true);
  await relay(baseTransmitter, l1, 1, true);
  await relay(baseTransmitter, l1, 2);
  await l1.call("finalizeOperation", [1n]);
  assert.equal(await l1.call("claimCash", [1n, alice]), 120n * U);
});
test("pre-burn cancellation and receiving callbacks cannot be hijacked", async () => {
  const { l1, inbox, alice, attacker } = await fixture();
  await l1.call("requestDeposit", [25n * U, alice]);
  await assert.rejects(l1.call("requestExit", [1n], attacker), /Unauthorized/);
  await l1.call("requestExit", [1n]);
  await assert.rejects(l1.call("bridgeDeposit", [1n]), /WrongState/);
  assert.equal(await l1.call("claimCash", [1n, alice]), 25n * U);
  await l1.call("finalizeOperation", [1n]);
  await assert.rejects(
    inbox.call("handleReceiveFinalizedMessage", [
      0,
      padHex(attacker, { size: 32 }),
      2000,
      "0x",
    ]),
    /InvalidMessage/,
  );
  await assert.rejects(
    inbox.call("handleReceiveUnfinalizedMessage", [
      0,
      padHex(attacker, { size: 32 }),
      1000,
      "0x",
    ]),
    /InvalidMessage/,
  );
});
test("an authenticated Base emergency stops new L1 exposure while preserving cancellation and claims", async () => {
  const { l1, inbox, native, baseTransmitter, relay, alice } = await fixture();
  await l1.call("requestDeposit", [25n * U, alice]);
  await assert.rejects(inbox.call("announceStop"), /WrongState/);
  await native.call("setEmergency", [true]);
  await inbox.call("announceStop");
  await relay(baseTransmitter, l1, 0);
  assert.equal(await l1.read("remoteStopped"), true);
  await assert.rejects(l1.call("bridgeDeposit", [1n]), /WrongState/);
  await assert.rejects(l1.call("requestDeposit", [U, alice]), /WrongState/);
  await l1.call("requestExit", [1n]);
  assert.equal(await l1.call("claimCash", [1n, alice]), 25n * U);
  await l1.call("finalizeOperation", [1n]);
});
