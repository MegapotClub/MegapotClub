import assert from "node:assert/strict";
import {
  getContractAddress,
  keccak256,
  padHex,
  toHex,
  encodeAbiParameters,
} from "viem";
import { createAddressFromString } from "@ethereumjs/util";
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
export async function createRoute(
  h,
  baseToken,
  l1Token,
  service,
  maximumBurn = 100_000n * 1_000_000n,
) {
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
      maximumBurn,
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
      maximumBurn,
    ],
    service.address,
  ]);
  assert.equal(l1.address.toLowerCase(), l1Address.toLowerCase());
  assert.equal(inbox.address.toLowerCase(), baseAddress.toLowerCase());
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
    l1Transmitter,
    baseTransmitter,
    l1Messenger,
    baseMessenger,
    l1,
    inbox,
    relay,
  };
}
