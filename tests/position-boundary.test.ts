import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, keccak256, type Abi } from "viem";
import abis from "../src/vaultAbi.json" with { type: "json" };
const owner = "0x1111111111111111111111111111111111111111" as const;
const vault = "0x2222222222222222222222222222222222222222" as const;
const asset = "0x3333333333333333333333333333333333333333" as const;
const position = "0x4444444444444444444444444444444444444444" as const;
const unrelated = "0x5555555555555555555555555555555555555555" as const;
const missing = "0x6666666666666666666666666666666666666666" as const;
const hash = `0x${"ab".repeat(32)}` as const,
  code = "0x60006000" as const,
  codeHash = keccak256(code);
const config = (product: any) => ({
  product,
  state: "deployed" as const,
  chainId: product.startsWith("base") ? (8453 as const) : (1 as const),
  deployedAtBlock: 1n,
  vault: { address: vault, codeHash },
  asset: { address: asset, codeHash },
  dependencies: [
    { address: position, codeHash },
    { address: unrelated, codeHash },
  ],
});
let livePosition: string = position,
  liveController: string = vault,
  calls: any[] = [];
const client = {
  getBlock: async () => ({
    number: 123n,
    hash,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  }),
  getBalance: async () => 10n ** 20n,
  getCode: async ({ address }: any) => (address === owner ? "0x" : code),
  readContract: async ({ functionName }: any) => {
    if (functionName === "weth") return asset;
    if (functionName === "position") return livePosition;
    if (functionName === "controller") return liveController;
    if (["balanceOf", "allowance"].includes(functionName)) return 10n ** 20n;
    if (functionName === "phase") return 0;
    if (functionName === "debt") return 100_000_000n;
    if (functionName === "health") return 2n * 10n ** 18n;
    throw new Error("Unmocked view " + functionName);
  },
  call: async (c: any) => {
    calls.push(c);
    return { data: "0x" };
  },
};
mock.module("../src/vaultRegistry.ts", {
  namedExports: {
    deployedVault: (p: any) => config(p),
    productDecimals: (p: string) => (p.endsWith("eth") ? 18 : 6),
  },
});
mock.module("../src/evmClient.ts", {
  namedExports: {
    atEvmEndpoint: async (_chain: unknown, _urls: unknown, work: any) =>
      work(client, "https://base.test.invalid"),
  },
});
const { planVaultCall, readVault, reviewVault, vaultAbi } = await import(
  "../src/vaults.ts"
);
beforeEach(() => {
  livePosition = position;
  liveController = vault;
  calls = [];
});
test("position methods target the registered dependency with zero value and exact request namespace", () => {
  for (const product of ["base-eth", "l1-eth"] as const) {
    for (const [operation, method, args] of [
      ["cancelDeposit", "cancelDeposit", [7n]],
      ["startRedeem", "startRedeem", undefined],
      ["closeDeposit", "closeRequest", [7n, true]],
      ["closeRedeem", "closeRequest", [7n, false]],
    ] as const) {
      const call = planVaultCall(
        config(product),
        owner,
        { kind: "position", operation, id: 7n },
        0n,
        position,
      );
      assert.equal(call.to, position);
      assert.equal(call.value, 0n);
      const decoded = decodeFunctionData({
        abi: abis.ServicePosition as Abi,
        data: call.data,
      });
      assert.equal(decoded.functionName, method);
      assert.deepEqual(decoded.args, args);
    }
  }
  const deposit = planVaultCall(
    config("l1-eth"),
    owner,
    { kind: "position", operation: "collectRemoteDeposit", id: 7n },
    0n,
    position,
  );
  const exit = planVaultCall(
    config("l1-eth"),
    owner,
    { kind: "position", operation: "collectRemoteExit", id: 7n },
    0n,
    position,
  );
  assert.deepEqual(
    decodeFunctionData({ abi: abis.ServicePosition as Abi, data: deposit.data })
      .args,
    [7n, true],
  );
  assert.deepEqual(
    decodeFunctionData({ abi: abis.ServicePosition as Abi, data: exit.data })
      .args,
    [7n, false],
  );
});
test("position planner rejects unknown targets, methods, wrong-chain operations and unsafe IDs", () => {
  for (const target of [undefined, missing])
    assert.throws(
      () =>
        planVaultCall(
          config("base-eth"),
          owner,
          { kind: "position", operation: "cancelDeposit", id: 1n },
          0n,
          target,
        ),
      /contractChanged/,
    );
  for (const id of [0n, -1n, 2n ** 256n])
    assert.throws(
      () =>
        planVaultCall(
          config("base-eth"),
          owner,
          { kind: "position", operation: "cancelDeposit", id },
          0n,
          position,
        ),
      /invalidAmount/,
    );
  assert.throws(
    () =>
      planVaultCall(
        config("base-usdc"),
        owner,
        { kind: "position", operation: "cancelDeposit", id: 1n },
        0n,
        position,
      ),
    /contractChanged/,
  );
  assert.throws(
    () =>
      planVaultCall(
        config("l1-eth"),
        owner,
        { kind: "position", operation: "claimDepositLot", id: 1n },
        0n,
        position,
      ),
    /invalidAction/,
  );
  assert.throws(
    () =>
      planVaultCall(
        config("base-eth"),
        owner,
        { kind: "position", operation: "collectRemoteExit", id: 1n },
        0n,
        position,
      ),
    /invalidAction/,
  );
  assert.throws(
    () =>
      planVaultCall(
        config("base-eth"),
        owner,
        { kind: "position", operation: "allocate" as any, id: 1n },
        0n,
        position,
      ),
    /invalidAction/,
  );
});
test("fresh review requires the immutable controller backlink, including when a substituted target has another dependency pin", async () => {
  const review = await reviewVault(
    ["https://base.test.invalid"],
    "base-eth",
    owner,
    { kind: "position", operation: "closeDeposit", id: 7n },
  );
  assert.equal(review.call.to, position);
  assert.equal(calls.length, 1);
  calls = [];
  livePosition = missing;
  await assert.rejects(
    readVault(["https://base.test.invalid"], "base-eth", owner),
    /contractChanged/,
  );
  assert.equal(calls.length, 0);
  livePosition = unrelated;
  liveController = missing;
  await assert.rejects(
    reviewVault(["https://base.test.invalid"], "base-eth", owner, {
      kind: "position",
      operation: "closeDeposit",
      id: 7n,
    }),
    /contractChanged/,
  );
  assert.equal(calls.length, 0);
});
test("flash defense preserves 6-decimal USDC and 18-decimal WETH bounds without user native value or an approval", () => {
  const amount = 100_000_001n,
    maxWeth = 123_456_789_000_000_001n;
  for (const product of ["base-eth", "l1-eth"] as const) {
    const call = planVaultCall(config(product), owner, {
      kind: "defend",
      amount,
      maxWeth,
    });
    assert.equal(call.to, vault);
    assert.equal(call.value, 0n);
    assert.deepEqual(
      decodeFunctionData({ abi: vaultAbi(product), data: call.data }),
      { functionName: "defendWithFlash", args: [amount, maxWeth] },
    );
  }
  assert.throws(
    () =>
      planVaultCall(config("base-usdc"), owner, {
        kind: "defend",
        amount,
        maxWeth,
      }),
    /invalidAction/,
  );
  for (const n of [0n, -1n, 2n ** 256n]) {
    assert.throws(
      () =>
        planVaultCall(config("base-eth"), owner, {
          kind: "defend",
          amount: n,
          maxWeth,
        }),
      /invalidAmount/,
    );
    assert.throws(
      () =>
        planVaultCall(config("base-eth"), owner, {
          kind: "defend",
          amount,
          maxWeth: n,
        }),
      /invalidAmount/,
    );
  }
});
