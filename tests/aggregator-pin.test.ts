import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256 } from "viem";
import { verifyVault } from "../src/vaults.ts";
import { parseDeployments, type ReadyVault } from "../src/vaultRegistry.ts";
const vault = "0x1111111111111111111111111111111111111111" as const;
const asset = "0x2222222222222222222222222222222222222222" as const;
const feed = "0x3333333333333333333333333333333333333333" as const;
const aggregator = "0x4444444444444444444444444444444444444444" as const;
const changed = "0x5555555555555555555555555555555555555555" as const;
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
    { address: feed, codeHash, aggregator: { address: aggregator, codeHash } },
  ],
};
const client = (overrides: Record<string, unknown> = {}) =>
  ({
    getCode: async () => code,
    readContract: async ({ functionName }: any) =>
      functionName === "asset" ? asset : aggregator,
    ...overrides,
  }) as unknown as Parameters<typeof verifyVault>[0];
const manifest = (entry: any) => ({
  schema: 1,
  deployments: [
    entry,
    ...["base-eth", "l1-usdc", "l1-eth"].map((product) => ({
      product,
      state: "undeployed",
    })),
  ],
});
test("manifest preserves a valid aggregator pin and rejects incomplete or zero-address pins", () => {
  const entry = { ...d, deployedAtBlock: "1" };
  assert.deepEqual(parseDeployments(manifest(entry))[0], d);
  for (const pin of [
    { address: aggregator },
    { address: "0x0000000000000000000000000000000000000000", codeHash },
    { address: aggregator, codeHash: "0x12" },
  ])
    assert.throws(
      () =>
        parseDeployments(
          manifest({
            ...entry,
            dependencies: [{ address: feed, codeHash, aggregator: pin }],
          }),
        ),
      /invalidDeployment/,
    );
});
test("aggregator identity and runtime are checked at the review block; upgrade or RPC failure rejects review", async () => {
  const observations: bigint[] = [];
  await verifyVault(
    client({
      getCode: async ({ blockNumber }: any) => {
        observations.push(blockNumber);
        return code;
      },
      readContract: async ({ functionName, blockNumber }: any) => {
        observations.push(blockNumber);
        return functionName === "asset" ? asset : aggregator;
      },
    }),
    123n,
    d,
  );
  assert.ok(observations.every((b) => b === 123n));
  await assert.rejects(
    verifyVault(
      client({
        readContract: async ({ functionName }: any) =>
          functionName === "asset" ? asset : changed,
      }),
      123n,
      d,
    ),
    /contractChanged/,
  );
  await assert.rejects(
    verifyVault(
      client({
        getCode: async ({ address }: any) =>
          address === aggregator ? "0x60016000" : code,
      }),
      123n,
      d,
    ),
    /contractChanged/,
  );
  await assert.rejects(
    verifyVault(
      client({
        readContract: async () => {
          throw new Error("RPC unavailable");
        },
      }),
      123n,
      d,
    ),
    /RPC unavailable/,
  );
});
