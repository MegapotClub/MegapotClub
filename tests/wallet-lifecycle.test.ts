import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
} from "viem";
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { Review } from "../src/native.ts";
import { walletRequestRefused, walletError } from "../src/wallet.ts";
import * as realNative from "../src/native.ts";
import { createLocks } from "./fixtures/locks.ts";
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
let discoveredDuringTarget = false;
let eventCount = 0;
let blockTimestamp = Math.floor(Date.now() / 1000);
let transactionReads = 0;
let eventQueries: unknown[] = [];
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
  value: { locks: createLocks() },
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
  getTransaction: async () => {
    transactionReads++;
    return {
      nonce: 9,
      from: account,
      to: JACKPOT,
      input: "0x30fcc737",
      value: 0n,
    };
  },
  waitForTransactionReceipt: async () => new Promise(() => {}),
  getTransactionReceipt: async () => ({
    status: "success",
    blockNumber: 100n,
    blockHash: hash,
    logs: eventCount
      ? Array.from({ length: eventCount }, (_, i) => ({
          address: JACKPOT,
          topics: encodeEventTopics({
            abi: realNative.jackpotAbi,
            eventName: "TicketWinningsClaimed",
            args: { userAddress: account, drawingId: 1n },
          }),
          data: encodeAbiParameters(
            parseAbiParameters("uint256,uint256,bool,uint256"),
            [BigInt(i + 1), 3n, false, 1_000_000n],
          ),
        }))
      : [],
  }),
  getContractEvents: async (args: unknown) => {
    eventQueries.push(args);
    return Array.from({ length: eventCount }, () => ({
      transactionHash: hash,
    }));
  },
  getBlockNumber: async () => 102n,
  getBlock: async () => ({
    hash,
    timestamp: BigInt(blockTimestamp),
  }),
};
mock.module("../src/native.ts", {
  namedExports: {
    ...realNative,
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
    prepareWalletTarget: async (who: string, rev: number) => {
      if (discoveredDuringTarget) {
        const old = journals().find((j) => j.status === "unknown")!;
        await writeJournal({ ...old, hash, status: "pending" });
      }
      if (who !== account || rev !== revision) throw new Error("walletChanged");
      return providerChanged ? replacementProvider : provider;
    },
    assertWalletTarget: async (who: string, rev: number) => {
      if (who !== account || rev !== revision) throw new Error("walletChanged");
      return providerChanged ? replacementProvider : provider;
    },
    walletRequestRefused,
    walletError,
  },
});
const {
  submitReview,
  journals,
  reconcile,
  writeJournal,
  findTransactionCandidates,
} = await import("../src/transactions.ts");
beforeEach(() => {
  storage.clear();
  storage.set("megapot-club:transactions:v1", "[]");
  revision = 1;
  sent = [];
  walletFailure = null;
  stateChangesDuringGas = false;
  providerChangesDuringGas = false;
  providerChanged = false;
  discoveredDuringTarget = false;
  eventCount = 0;
  transactionReads = 0;
  eventQueries = [];
  blockTimestamp = Math.floor(Date.now() / 1000);
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
test("identity change during gas estimation prevents the wallet request", async () => {
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

test("refused wallet requests release only the new reservation and permit a new explicit click", async () => {
  for (const code of [4100, 4200, -32002, -32601, -32602]) {
    walletFailure = { cause: { code } };
    await assert.rejects(submitReview(["https://base.example"], quote, 1));
    assert.equal(journals().at(-1)?.status, "rejected");
  }
  walletFailure = null;
  assert.equal(
    (await submitReview(["https://base.example"], quote, 1)).status,
    "pending",
  );
});
test("an explicit identical claim retry preserves its ambiguous predecessor; pending hashes cannot retry", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("relay unavailable");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /ambiguousClaim/,
  );
  const first = journals()[0];
  await assert.rejects(
    submitReview(
      ["https://base.example"],
      { ...quote, calls: [{ ...quote.calls[0], data: "0x12345678" }] },
      1,
    ),
    /unresolvedTransaction/,
  );
  walletFailure = null;
  const second = await submitReview(["https://base.example"], quote, 1);
  assert.equal(second.retryOf, first.id);
  assert.equal(journals()[0].status, "unknown");
  assert.equal(journals()[1].status, "pending");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /unresolvedTransaction/,
  );
  assert.equal(sent.length, 2);
});

test("claim recovery groups thirty ticket events into one candidate and tolerates device-clock skew", async () => {
  quote = {
    ...quote,
    action: {
      kind: "claim",
      ids: Array.from({ length: 30 }, (_, i) => BigInt(i + 1)),
    },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("response lost");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /ambiguousClaim/,
  );
  const first = journals()[0];
  await writeJournal({
    ...first,
    id: "uncertain-retry",
    retryOf: first.id,
    createdAt: Date.now() + 1,
    nonce: first.nonce + 3,
  });
  eventCount = 30;
  blockTimestamp -= 600;
  await findTransactionCandidates(["https://base.example"], first);
  assert.equal(transactionReads, 1);
  assert.equal(
    (eventQueries[0] as { eventName: string }).eventName,
    "TicketWinningsClaimed",
  );
  assert.deepEqual(journals()[0].recovery?.candidates, [hash]);
  await reconcile(["https://base.example"], journals()[0], hash);
  assert.equal(journals()[0].status, "confirmed");
  assert.equal(journals()[0].claimReceipt?.ticketIds.length, 30);
  const retry = journals().find((j) => j.id === "uncertain-retry")!;
  assert.equal(retry.status, "superseded");
  assert.equal(retry.hash, undefined);
  assert.equal(retry.resolvedBy, hash);
  assert.equal(sent.length, 1);
});
test("a hash discovered during claim retry preparation prevents the second wallet handoff", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("response lost");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /ambiguousClaim/,
  );
  discoveredDuringTarget = true;
  walletFailure = null;
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /claimAlreadySent/,
  );
  assert.equal(sent.length, 1);
  assert.equal(journals()[0].hash, hash);
  assert.equal(journals()[1].status, "rejected");
});

test("a synchronous wallet hash remains a dispatched transaction", async (t) => {
  t.mock.method(
    provider,
    "request",
    (() => hash) as unknown as typeof provider.request,
  );
  const entry = await submitReview(["https://base.example"], quote, 1);
  assert.equal(entry.hash, hash);
  assert.equal(journals()[0].status, "pending");
});
test("a retry hash arriving after the claim was fulfilled resumes real receipt tracking", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("response lost");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /ambiguousClaim/,
  );
  const first = journals()[0];
  const retry = {
    ...first,
    id: "waiting-retry",
    status: "wallet" as const,
    retryOf: first.id,
  };
  await writeJournal(retry);
  eventCount = 1;
  await reconcile(["https://base.example"], first, hash);
  assert.equal(journals().find((j) => j.id === retry.id)?.status, "superseded");
  const lateHash = `0x${"cd".repeat(32)}` as const;
  await writeJournal({ ...retry, hash: lateHash, status: "pending" });
  assert.equal(journals().find((j) => j.id === retry.id)?.status, "pending");
  assert.equal(journals().find((j) => j.id === retry.id)?.hash, lateHash);
  await writeJournal({ ...retry, status: "superseded", resolvedBy: hash });
  assert.equal(journals().find((j) => j.id === retry.id)?.hash, lateHash);
  assert.equal(journals().find((j) => j.id === retry.id)?.status, "pending");
});
