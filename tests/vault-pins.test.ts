import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { verifyVault } from "../src/vaults.ts";
import type { ReadyVault } from "../src/vaultRegistry.ts";
const vault = "0x1111111111111111111111111111111111111111" as const;
const asset = "0x2222222222222222222222222222222222222222" as const;
const proxy = "0x3333333333333333333333333333333333333333" as const;
const implementation = "0x4444444444444444444444444444444444444444" as const;
const unexpected = "0x5555555555555555555555555555555555555555" as const;
const code = "0x60006000" as const,
  codeHash = keccak256(code);
const d: ReadyVault = {
  product: "base-usdc",
  state: "deployed",
  chainId: 8453,
  deployedAtBlock: 1n,
  vault: { address: vault, codeHash },
  asset: { address: asset, codeHash },
  dependencies: [
    {
      address: proxy,
      codeHash,
      implementation: {
        address: implementation,
        codeHash,
        slot: `0x${"ab".repeat(32)}`,
      },
    },
  ],
};
function client(overrides: Record<string, unknown> = {}) {
  return {
    getCode: async () => code,
    getStorageAt: async () => `0x${"00".repeat(12)}${implementation.slice(2)}`,
    readContract: async () => asset,
    ...overrides,
  } as unknown as Parameters<typeof verifyVault>[0];
}
test("review pins cover configured proxy slot, runtime and asset backlink at the same block", async () => {
  const blocks: bigint[] = [];
  await verifyVault(
    client({
      getCode: async ({ blockNumber }: any) => {
        blocks.push(blockNumber);
        return code;
      },
      getStorageAt: async ({ blockNumber }: any) => {
        blocks.push(blockNumber);
        return `0x${"00".repeat(12)}${implementation.slice(2)}`;
      },
      readContract: async ({ blockNumber }: any) => {
        blocks.push(blockNumber);
        return asset;
      },
    }),
    123n,
    d,
  );
  assert.ok(blocks.length >= 6);
  assert.ok(blocks.every((b) => b === 123n));
});
test("changed dependency runtime, proxy target or vault asset fail closed", async () => {
  await assert.rejects(
    verifyVault(
      client({
        getCode: async ({ address }: any) =>
          address === proxy ? "0x60016000" : code,
      }),
      123n,
      d,
    ),
    /contractChanged/,
  );
  await assert.rejects(
    verifyVault(
      client({
        getStorageAt: async () => `0x${"00".repeat(12)}${unexpected.slice(2)}`,
      }),
      123n,
      d,
    ),
    /contractChanged/,
  );
  await assert.rejects(
    verifyVault(client({ readContract: async () => unexpected }), 123n, d),
    /contractChanged/,
  );
});
