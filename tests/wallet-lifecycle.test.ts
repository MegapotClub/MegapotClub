import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { Review } from "../src/native.ts";
import { JACKPOT } from "../src/config.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"ab".repeat(32)}` as const;
let revision = 1,
  sent: unknown[] = [],
  walletFailure: unknown = null,
  stateChangesDuringGas = false,
  providerChangesDuringGas = false,
  providerChanged = false;
let quote: Review;
const storage = new Map<string, string>();
const globals = ["localStorage", "window", "navigator"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
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
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const client = {
  getChainId: async () => 8453,
  estimateGas: async () => {
    if (stateChangesDuringGas) revision++;
    if (providerChangesDuringGas) providerChanged = true;
    return 30_000n;
  },
  getGasPrice: async () => 1n,
  getTransactionCount: async () => 7,
  getTransaction: async () => ({
    nonce: 9,
    from: account,
    to: JACKPOT,
    input: "0x30fcc737",
    value: 0n,
  }),
  waitForTransactionReceipt: async () => new Promise(() => {}),
  getTransactionReceipt: async () => ({
    status: "success",
    blockNumber: 100n,
    blockHash: hash,
  }),
  getBlockNumber: async () => 102n,
  getBlock: async () => ({
    hash,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  }),
};
mock.module("../src/native.ts", {
  namedExports: {
    nativeClient: () => client,
    atNativeEndpoint: async (
      _urls: string[],
      read: (c: typeof client, endpoint: string) => unknown,
    ) => read(client, "https://base.example"),
    reviewAction: async () => quote,
  },
});
const provider = {
  request: async (request: unknown) => {
    sent.push(request);
    if (walletFailure) throw walletFailure;
    return hash;
  },
};
const replacementProvider = { ...provider };
mock.module("../src/wallet.ts", {
  namedExports: {
    assertWallet: async (who: string, rev: number) => {
      if (who !== account || rev !== revision) throw new Error("walletChanged");
      return providerChanged ? replacementProvider : provider;
    },
    walletError: (e: { code?: number }) =>
      e?.code === 4001 ? "rejected" : "walletFailed",
  },
});
const { submitReview, journals, reconcile } = await import(
  "../src/transactions.ts"
);
beforeEach(() => {
  storage.clear();
  storage.set("megapot-club:transactions:v1", "[]");
  revision = 1;
  sent = [];
  walletFailure = null;
  stateChangesDuringGas = false;
  providerChangesDuringGas = false;
  providerChanged = false;
  quote = {
    account,
    action: { kind: "finalize" },
    block: 100n,
    createdAt: Date.now(),
    amount: 1_000_000n,
    position: { ether: 10n ** 18n } as Review["position"],
    calls: [{ to: JACKPOT, data: "0x30fcc737", value: 0n, kind: "finalize" }],
    endpoint: "https://base.example",
  };
});
test("an explicit submission sends once, records the actual wallet-selected nonce and blocks duplicates", async () => {
  const entry = await submitReview(["https://base.example"], quote, revision);
  assert.equal(entry.status, "pending");
  assert.equal(entry.nonce, 9);
  assert.equal(entry.nonceConfirmed, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    method: "eth_sendTransaction",
    params: [
      {
        from: account,
        to: JACKPOT,
        data: "0x30fcc737",
        value: "0x0",
        chainId: "0x2105",
        gas: "0x8ca0",
      },
    ],
  });
  await assert.rejects(
    submitReview(["https://base.example"], quote, revision),
    /unresolvedTransaction/,
  );
  assert.equal(sent.length, 1);
});
test("account/chain change during gas estimation prevents the wallet request", async () => {
  stateChangesDuringGas = true;
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /walletChanged/,
  );
  assert.equal(sent.length, 0);
  assert.equal(journals().length, 0);
});
test("a changed provider at the final handoff cannot receive or reroute a reviewed transaction", async () => {
  providerChangesDuringGas = true;
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /walletChanged/,
  );
  assert.equal(sent.length, 0);
  assert.equal(journals().length, 0);
});
test("expired or economically changed reviews cannot submit", async () => {
  await assert.rejects(
    submitReview(
      ["https://base.example"],
      { ...quote, createdAt: Date.now() - 121_000 },
      1,
    ),
    /reviewExpired/,
  );
  await assert.rejects(
    submitReview(["https://base.example"], { ...quote, amount: 2n }, 1),
    /reviewChanged/,
  );
  assert.equal(sent.length, 0);
});
test("a claim refreshes payout and draw state without requiring a second confirmation", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
    position: { ...quote.position, draw: 176n, emergency: true },
  };
  const old = {
    ...quote,
    createdAt: Date.now() - 600_000,
    amount: 2n,
    position: { ...quote.position, draw: 175n, emergency: false },
  };
  let displayed: Review | undefined;
  const entry = await submitReview(
    ["https://base.example"],
    old,
    1,
    undefined,
    (fresh) => {
      displayed = fresh;
    },
  );
  assert.equal(entry.status, "pending");
  assert.equal(displayed, quote);
  assert.equal(sent.length, 1);
});
test("claims still reject altered calldata, destinations and cancellation before signing", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  for (const call of [
    { ...quote.calls[0], data: "0x12345678" as const },
    { ...quote.calls[0], to: account },
    { ...quote.calls[0], value: 1n as unknown as 0n },
  ]) {
    await assert.rejects(
      submitReview(["https://base.example"], { ...quote, calls: [call] }, 1),
      /reviewChanged/,
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1, controller.signal),
    /reviewCancelled/,
  );
  assert.equal(sent.length, 0);
});
test("wallet rejection is distinct from an ambiguous response; an ambiguous request is never retried", async () => {
  walletFailure = { code: 4001 };
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /rejected/,
  );
  assert.equal(journals()[0].status, "rejected");
  walletFailure = new Error("connection dropped");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /ambiguousTransaction/,
  );
  assert.equal(journals()[1].status, "unknown");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /unresolvedTransaction/,
  );
  assert.equal(sent.length, 2);
});
test("an explicit wallet hash can reconcile an ambiguous request without requesting another transaction", async () => {
  walletFailure = new Error("connection dropped");
  await assert.rejects(submitReview(["https://base.example"], quote, 1));
  const entry = journals()[0];
  assert.equal(entry.hash, undefined);
  await reconcile(["https://base.example"], entry, hash);
  assert.equal(journals()[0].status, "confirmed");
  assert.equal(sent.length, 1);
});
