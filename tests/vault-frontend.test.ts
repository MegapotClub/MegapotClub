import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { VaultReview } from "../src/vaults.ts";
const account = "0x1111111111111111111111111111111111111111" as const;
const target = "0x2222222222222222222222222222222222222222" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
let revision = 1,
  changedDuringGas = false,
  replaceProviderDuringGas = false,
  providerChanged = false,
  sends: any[] = [],
  fresh: VaultReview;
let abortDuringGas: AbortController | undefined;
let txValue = 1_000_000_000_000_000_001n,
  paths: number[] = [];
const key = "megapot-club:transactions:v1";
const storage = new Map<string, string>();
const globals = ["localStorage", "window", "navigator"].map(
  (k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const,
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: new EventTarget(),
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {},
});
after(() => {
  for (const [key, d] of globals) {
    if (d) Object.defineProperty(globalThis, key, d);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const client = {
  getChainId: async () => fresh.chainId,
  estimateGas: async () => {
    if (changedDuringGas) revision++;
    if (replaceProviderDuringGas) providerChanged = true;
    abortDuringGas?.abort();
    return 30_000n;
  },
  getGasPrice: async () => 1n,
  getTransactionCount: async () => 7,
  getTransaction: async () => ({
    nonce: 9,
    from: account,
    to: target,
    input: "0x12345678",
    value: txValue,
  }),
  waitForTransactionReceipt: async () => new Promise(() => {}),
  getTransactionReceipt: async () => ({
    status: "success",
    blockNumber: 100n,
    blockHash,
  }),
  getBlockNumber: async () => 102n,
  getBlock: async () => ({
    hash: blockHash,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  }),
};
mock.module("../src/native.ts", {
  namedExports: {
    nativeClient: () => client,
    atNativeEndpoint: async (_u: unknown, read: any) => {
      paths.push(8453);
      return read(client, "https://base.example");
    },
    reviewAction: () => {
      throw new Error("unexpected native review");
    },
  },
});
mock.module("../src/evmClient.ts", {
  namedExports: {
    evmClient: () => client,
    atEvmEndpoint: async (chain: number, _u: unknown, read: any) => {
      paths.push(chain);
      return read(client, "https://ethereum.example");
    },
  },
});
mock.module("../src/vaults.ts", {
  namedExports: { reviewVault: async () => fresh },
});
const provider = {
  request: async (req: any) => {
    sends.push(req);
    return hash;
  },
};
const replacementProvider = { ...provider };
mock.module("../src/wallet.ts", {
  namedExports: {
    assertWallet: async (who: string, rev: number, chain: number = 8453) => {
      if (who !== account || rev !== revision || chain !== fresh.chainId)
        throw new Error("walletChanged");
      return providerChanged ? replacementProvider : provider;
    },
    walletError: () => "walletFailed",
  },
});
const { submitVaultReview, reconcile, journals } = await import(
  "../src/transactions.ts"
);
beforeEach(() => {
  storage.set(key, "[]");
  abortDuringGas = undefined;
  revision = 1;
  changedDuringGas = false;
  replaceProviderDuringGas = false;
  providerChanged = false;
  sends = [];
  paths = [];
  txValue = 1_000_000_000_000_000_001n;
  fresh = {
    product: "l1-eth",
    chainId: 1,
    account,
    intent: { kind: "deposit", amount: txValue },
    call: {
      to: target,
      data: "0x12345678",
      value: txValue,
      kind: "vaults",
      operation: "requestDeposit",
    },
    state: {
      block: 100n,
      blockHash,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      ether: 10n ** 20n,
      balance: 0n,
      shares: 0n,
      allowance: 0n,
      contractWallet: false,
      phase: "running",
    },
    endpoint: "https://ethereum.example",
    createdAt: Date.now(),
    simulation: hash,
  };
});
test("L1 ETH submission preserves exact wei, chain identity and actual nonce", async () => {
  const e = await submitVaultReview(["https://ethereum.example"], fresh, 1);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].params[0].chainId, "0x1");
  assert.equal(BigInt(sends[0].params[0].value), txValue);
  assert.equal(e.value, txValue.toString());
  assert.equal(e.nonce, 9);
  assert.equal(e.nonceConfirmed, true);
  await reconcile(["https://ethereum.example"], e);
  assert.deepEqual(paths, [1]);
  assert.equal(journals()[0].status, "confirmed");
});
test("account/chain revision race during gas estimate prevents send", async () => {
  changedDuringGas = true;
  await assert.rejects(
    submitVaultReview(["https://ethereum.example"], fresh, 1),
    /walletChanged/,
  );
  assert.equal(sends.length, 0);
  assert.equal(journals().length, 0);
});
test("vault handoff rejects a provider replacement before journaling or signing", async () => {
  replaceProviderDuringGas = true;
  await assert.rejects(
    submitVaultReview(["https://ethereum.example"], fresh, 1),
    /walletChanged/,
  );
  assert.equal(sends.length, 0);
  assert.equal(journals().length, 0);
});
test("changed exact wei value invalidates a reviewed request", async () => {
  const reviewed = { ...fresh, call: { ...fresh.call, value: txValue - 1n } };
  await assert.rejects(
    submitVaultReview(["https://ethereum.example"], reviewed, 1),
    /reviewChanged/,
  );
  assert.equal(sends.length, 0);
});
test("manual unknown-hash reconciliation rejects value mismatch and uses L1 only", async () => {
  const e = {
    schema: 1 as const,
    id: "uncertain",
    account,
    chainId: 1 as const,
    value: txValue.toString(),
    to: target,
    data: "0x12345678" as const,
    kind: "vaults" as const,
    nonce: 7,
    createdAt: Date.now(),
    status: "unknown" as const,
  };
  storage.set(key, JSON.stringify([e]));
  txValue--;
  await assert.rejects(
    reconcile(["https://ethereum.example"], e, hash),
    /wrongReplacement/,
  );
  assert.deepEqual(paths, [1]);
  assert.equal(journals()[0].status, "unknown");
  assert.equal(sends.length, 0);
});
test("resolved Base journal counterexample: unrelated L1 vault send remains available", async () => {
  storage.set(
    key,
    JSON.stringify([
      {
        schema: 1,
        id: "base-pending",
        account,
        chainId: 8453,
        to: target,
        data: "0x12345678",
        kind: "deposit",
        nonce: 42,
        createdAt: Date.now(),
        status: "unknown",
      },
    ]),
  );
  const entry = await submitVaultReview(["https://ethereum.example"], fresh, 1);
  assert.equal(entry.chainId, 1);
  assert.equal(sends.length, 1);
  assert.equal(journals().length, 2);
});

test("dismissal during preflight aborts without journaling or sending", async () => {
  const controller = new AbortController();
  abortDuringGas = controller;
  await assert.rejects(
    submitVaultReview(
      ["https://ethereum.example"],
      fresh,
      1,
      controller.signal,
    ),
    /reviewChanged/,
  );
  assert.equal(sends.length, 0);
  assert.equal(journals().length, 0);
});
