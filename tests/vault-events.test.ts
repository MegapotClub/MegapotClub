import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  keccak256,
  encodeEventTopics,
  encodeAbiParameters,
  type Abi,
} from "viem";
import abis from "../src/vaultAbi.json" with { type: "json" };
const owner = "0x1111111111111111111111111111111111111111" as const;
const asset = "0x2222222222222222222222222222222222222222" as const;
const vault = "0x3333333333333333333333333333333333333333" as const;
const unrelated = "0x4444444444444444444444444444444444444444" as const;
const code = "0x60006000" as const,
  codeHash = keccak256(code),
  head = 30_000n;
const d = {
  product: "base-usdc",
  state: "deployed",
  chainId: 8453,
  deployedAtBlock: 1n,
  vault: { address: vault, codeHash },
  asset: { address: asset, codeHash },
  dependencies: [{ address: unrelated, codeHash }],
};
const abi = abis.BaseUsdcVault as Abi;
function committed(
  name: "DepositCommitted" | "ExitCommitted",
  lot: bigint,
  request: bigint,
  index: number,
) {
  return {
    address: vault,
    removed: false,
    blockNumber: head - 10n,
    transactionHash: `0x${"ab".repeat(32)}`,
    logIndex: index,
    data: encodeAbiParameters([{ type: "uint256" }], [100n]),
    topics: encodeEventTopics({
      abi,
      eventName: name,
      args: { lot, request, draw: 8n },
    }),
  };
}
const logs = [
  committed("DepositCommitted", 7n, 1n, 0),
  committed("DepositCommitted", 8n, 1n, 1),
  committed("ExitCommitted", 9n, 1n, 2),
  committed("DepositCommitted", 10n, 2n, 3),
];
let lookups: any[] = [];
const client = {
  getBlockNumber: async () => head,
  getCode: async () => code,
  readContract: async (query: any) => {
    if (query.functionName === "asset") return asset;
    lookups.push(query);
    return [query.args[0] === 2n ? unrelated : owner, 100n, false];
  },
  getLogs: async ({ fromBlock, toBlock }: any) =>
    logs.filter(
      (log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
    ),
};
mock.module("../src/vaultRegistry.ts", {
  namedExports: { deployedVault: () => d, productDecimals: () => 6 },
});
mock.module("../src/evmClient.ts", {
  namedExports: {
    atEvmEndpoint: async (_chain: unknown, _urls: unknown, read: any) =>
      read(client, "https://base.example"),
  },
});
const { vaultEvents } = await import("../src/vaults.ts");
test("committed claim lots are recovered by current immutable controller even if original request predates scanned page", async () => {
  const page = await vaultEvents(["https://base.example"], "base-usdc", owner);
  assert.equal(page.from, 10_001n);
  assert.deepEqual(
    page.events.map((e) => e.args.lot),
    [9n, 8n, 7n],
  );
  assert.equal(lookups.length, 3);
  assert.ok(lookups.every((q) => q.blockNumber === head));
  assert.equal(
    lookups.filter((q) => q.functionName === "deposits" && q.args[0] === 1n)
      .length,
    1,
  );
  assert.equal(
    lookups.filter((q) => q.functionName === "redeems" && q.args[0] === 1n)
      .length,
    1,
  );
});
