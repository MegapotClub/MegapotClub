import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { rolldown } from "rolldown";
import { loadConfigFromFile } from "vite";
import { encodeFunctionData, type Hex } from "viem";
import { JACKPOT } from "../src/config.ts";
import { USDC, jackpotAbi, tokenAbi, actionCalls } from "../src/native.ts";
import type {
  CoinbaseWalletBoundaryAudit,
  CoinbaseFixtureTransaction,
} from "./fixtures/coinbaseWalletBoundary.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as Hex;
const config = await loadConfigFromFile({
  command: "build",
  mode: "production",
});
assert.ok(config);
const transform = config.config.build?.rolldownOptions?.transform;
assert.deepEqual(
  config.config.optimizeDeps?.rolldownOptions?.transform,
  transform,
);
async function sdk(inject: boolean) {
  const bundle = await rolldown({
    input: "tests/fixtures/coinbaseWalletBoundary.ts",
    platform: "browser",
    tsconfig: false,
    resolve: { alias: config!.config.resolve!.alias as Record<string, string> },
    transform: {
      ...(inject ? transform : {}),
      define: { "import.meta.env": "{}" },
    },
    onwarn(warning, warn) {
      if (warning.code !== "INEFFECTIVE_DYNAMIC_IMPORT") warn(warning);
    },
  });
  const { output } = await bundle.generate({
    format: "iife",
    name: "CoinbaseBoundary",
    codeSplitting: false,
  });
  await bundle.close();
  const realm: Record<string, unknown> = {
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    crypto: globalThis.crypto,
    fetch() {
      throw new Error("SDK fixture attempted network access");
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  realm.window = realm;
  runInNewContext(
    output.find((x) => x.type === "chunk")!.code +
      ";globalThis.boundary=CoinbaseBoundary;",
    realm,
  );
  return realm.boundary as {
    dispatchCoinbaseWalletFixture(
      input: CoinbaseFixtureTransaction,
      submit: (tx: CoinbaseFixtureTransaction) => Hex,
      audit: (data: CoinbaseWalletBoundaryAudit) => void,
    ): Promise<Hex>;
  };
}
const approve = encodeFunctionData({
  abi: tokenAbi,
  functionName: "approve",
  args: [JACKPOT, 10_000_000n],
});
const baseInput = {
  from: account,
  chainId: "0x2105" as const,
  gas: "0x8ca0" as const,
  value: "0x0" as const,
};
test("the actual Coinbase browser encoder requires an imported Buffer, without exposing a global", async () => {
  const broken = await sdk(false);
  let sent = 0;
  await assert.rejects(
    broken.dispatchCoinbaseWalletFixture(
      { ...baseInput, to: USDC, data: approve },
      () => {
        sent++;
        return hash;
      },
      () => {},
    ),
    /Buffer is not defined/,
  );
  assert.equal(sent, 0);
  const fixed = await sdk(true);
  const purchase = actionCalls(
    {
      kind: "purchase",
      recipient: account,
      referrer: account,
      drawId: 175n,
      unitPrice: 1_000_000n,
      orderId: "sdk-fixture",
      tickets: [{ numbers: [1, 2, 3, 4, 5], bonus: 6 }],
    },
    1_000_000n,
  )[0];
  const calls = [
    { to: USDC, data: approve, action: "approve" },
    { ...purchase, action: "buyTickets" },
    {
      to: JACKPOT,
      data: encodeFunctionData({
        abi: jackpotAbi,
        functionName: "claimWinnings",
        args: [[1n, 2n]],
      }),
      action: "claimWinnings",
    },
    {
      to: JACKPOT,
      data: encodeFunctionData({
        abi: jackpotAbi,
        functionName: "claimReferralFees",
      }),
      action: "claimReferralFees",
    },
  ];
  for (const call of calls) {
    const input = { ...baseInput, to: call.to, data: call.data };
    let audit: CoinbaseWalletBoundaryAudit | undefined;
    const result = await fixed.dispatchCoinbaseWalletFixture(
      input,
      (transaction) => {
        sent++;
        assert.equal(transaction.data, input.data);
        assert.equal(transaction.chainId, input.chainId);
        assert.equal(transaction.gas, input.gas);
        assert.equal(transaction.to.toLowerCase(), input.to.toLowerCase());
        return hash;
      },
      (data) => {
        audit = data;
      },
    );
    assert.equal(result, hash);
    assert.equal(audit?.action, call.action);
    assert.equal(audit?.calldataPreserved, true);
    assert.equal(audit?.globalBufferPresent, false);
  }
  assert.equal(sent, 4);
});
