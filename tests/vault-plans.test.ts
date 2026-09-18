import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, erc20Abi } from "viem";
import {
  planVaultCall,
  vaultAmount,
  vaultAbi,
  requestId,
  type VaultIntent,
} from "../src/vaults.ts";
import {
  parseDeployments,
  deployedVault,
  PRODUCTS,
  productChain,
  type ReadyVault,
} from "../src/vaultRegistry.ts";
import { parseRoute, routeHref } from "../src/navigation.ts";
import { vaultCopy, vaultKeys } from "../src/vaultCopy.ts";
const owner = "0x1111111111111111111111111111111111111111" as const;
const vault = "0x2222222222222222222222222222222222222222" as const;
const asset = "0x3333333333333333333333333333333333333333" as const;
const hash = `0x${"aa".repeat(32)}` as const;
const config = (product: ReadyVault["product"]): ReadyVault => ({
  product,
  state: "deployed",
  chainId: productChain(product),
  deployedAtBlock: 10n,
  vault: { address: vault, codeHash: hash },
  asset: { address: asset, codeHash: hash },
  dependencies: [{ address: owner, codeHash: hash }],
});
test("the release has no fabricated deployments and malformed activation manifests fail closed", () => {
  const empty = {
    schema: 1,
    deployments: PRODUCTS.map((product) => ({ product, state: "undeployed" })),
  };
  assert.equal(parseDeployments(empty).length, 4);
  for (const product of PRODUCTS)
    assert.throws(() => deployedVault(product), /notDeployed/);
  const ready = { ...config("base-usdc"), deployedAtBlock: "10" };
  const entries = [ready, ...empty.deployments.slice(1)];
  assert.equal(
    parseDeployments({ schema: 1, deployments: entries })[0].state,
    "deployed",
  );
  for (const patch of [
    { chainId: 1 },
    { deployedAtBlock: "-1" },
    { vault: { address: vault, codeHash: "0x00" } },
    { dependencies: [] },
    { state: "reviewed" },
  ]) {
    assert.throws(
      () =>
        parseDeployments({
          schema: 1,
          deployments: [{ ...ready, ...patch }, ...entries.slice(1)],
        }),
      /invalidDeployment/,
    );
  }
  assert.throws(
    () =>
      parseDeployments({
        schema: 1,
        deployments: [...entries.slice(0, 3), entries[0]],
      }),
    /invalidDeployment/,
  );
});
test("the planner separates exact USDC authorization, deposit value, receipts and immutable receivers", () => {
  const d = config("base-usdc"),
    amount = 123_456_789n;
  const approval = planVaultCall(
    d,
    owner,
    { kind: "deposit", amount },
    amount - 1n,
  );
  assert.equal(approval.to, asset);
  assert.equal(approval.value, 0n);
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: approval.data }), {
    functionName: "approve",
    args: [vault, amount],
  });
  const deposit = planVaultCall(d, owner, { kind: "deposit", amount }, amount);
  assert.equal(deposit.to, vault);
  assert.equal(deposit.value, 0n);
  assert.deepEqual(
    decodeFunctionData({ abi: vaultAbi(d.product), data: deposit.data }).args,
    [amount, owner],
  );
  const eth = planVaultCall(config("l1-eth"), owner, {
    kind: "deposit",
    amount: 10n ** 18n,
  });
  assert.equal(eth.value, 10n ** 18n);
  assert.equal(eth.to, vault);
  assert.deepEqual(
    decodeFunctionData({ abi: vaultAbi("l1-eth"), data: eth.data }).args,
    [10n ** 18n, owner, true],
  );
  const exit = planVaultCall(d, owner, { kind: "redeem", amount });
  assert.equal(
    decodeFunctionData({ abi: vaultAbi(d.product), data: exit.data })
      .functionName,
    "requestRedeem",
  );
  const cash = planVaultCall(config("l1-eth"), owner, {
    kind: "operate",
    operation: "claimAbortedCash",
    id: 7n,
  });
  assert.deepEqual(
    decodeFunctionData({ abi: vaultAbi("l1-eth"), data: cash.data }).args,
    [7n, owner, false],
  );
  assert.throws(
    () =>
      planVaultCall(config("l1-usdc"), owner, {
        kind: "operate",
        operation: "leverage",
      }),
    /invalidAction/,
  );
  assert.throws(
    () => planVaultCall(d, owner, { kind: "operate", operation: "claimExit" }),
    /invalidAmount/,
  );
  assert.throws(
    () =>
      planVaultCall(d, owner, { kind: "transfer", amount, receiver: vault }),
    /invalidAmount/,
  );
  assert.throws(
    () =>
      planVaultCall(d, owner, {
        kind: "arbitraryCall",
        to: owner,
        data: "0x",
      } as unknown as VaultIntent),
    /invalidAction/,
  );
});
test("token precision and uint256 request IDs never round or accept executable URL state", () => {
  assert.equal(vaultAmount("0.000000000000000001", "base-eth"), 1n);
  assert.equal(vaultAmount("0.000001", "base-usdc"), 1n);
  for (const amount of ["1e5", "-1", "0.0000001", "01", "1,000", "0"])
    assert.throws(() => vaultAmount(amount, "base-usdc"));
  assert.throws(() => requestId((2n ** 256n).toString()));
  const route = {
    view: "lp",
    tab: "vaults",
    product: "l1-eth",
    vaultView: "requests",
    request: "42",
    requestKind: "exit",
  } as const;
  assert.deepEqual(parseRoute(routeHref(route)), route);
  const malicious = parseRoute(
    "#lp?tab=vaults&product=l1-eth&vaultView=sign&request=eval()&rpc=https://evil.example&data=0xdead&to=" +
      owner,
  );
  assert.deepEqual(malicious, { view: "lp", tab: "vaults", product: "l1-eth" });
  for (const locale of [
    "en",
    "es",
    "pt-BR",
    "fr",
    "de",
    "zh-CN",
    "ja",
    "ko",
  ] as const)
    for (const key of vaultKeys) assert.ok(vaultCopy(locale)(key).length > 0);
});
