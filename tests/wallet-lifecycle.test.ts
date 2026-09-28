import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { Action, Review } from "../src/native.ts";
import { walletRequestRefused, walletError } from "../src/wallet.ts";
import * as realNative from "../src/native.ts";
import { createLocks } from "./fixtures/locks.ts";
import { claimLogs, purchaseLogs } from "./fixtures/receipts.ts";
import { bundle } from "./fixtures/userOperations.ts";
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
let bundled: ReturnType<typeof bundle> | undefined;
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
    return (
      bundled?.tx ?? {
        nonce: 9,
        from: account,
        to: JACKPOT,
        input: "0x30fcc737",
        value: 0n,
      }
    );
  },
  waitForTransactionReceipt: async () => new Promise(() => {}),
  getTransactionReceipt: async () =>
    bundled?.receipt ?? {
      status: "success",
      blockNumber: 100n,
      blockHash: hash,
      logs: claimLogs(account, eventCount),
    },
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
  bundled = undefined;
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
test("each explicit submission sends once and retains the actual wallet-selected nonce", async () => {
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
  const next = await submitReview(["https://base.example"], quote, revision);
  assert.equal(sent.length, 2);
  assert.notEqual(next.id, entry.id);
  assert.equal(journals()[0].hash, hash);
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
test("wallet errors remain recorded and only a new explicit action retries", async () => {
  walletFailure = { code: 4001 };
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /rejected/,
  );
  assert.equal(journals()[0].status, "rejected");
  walletFailure = new Error("connection dropped");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /walletNoResponse/,
  );
  assert.equal(journals()[1].status, "unknown");
  assert.equal(sent.length, 2);
  walletFailure = null;
  await submitReview(["https://base.example"], quote, 1);
  assert.equal(sent.length, 3);
  assert.equal(journals()[1].status, "unknown");
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
test("claim retries preserve prior attempts while fresh calldata checks remain mandatory", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("relay unavailable");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /walletNoResponse/,
  );
  const first = journals()[0];
  await assert.rejects(
    submitReview(
      ["https://base.example"],
      { ...quote, calls: [{ ...quote.calls[0], data: "0x12345678" }] },
      1,
    ),
    /reviewChanged/,
  );
  walletFailure = null;
  const second = await submitReview(["https://base.example"], quote, 1);
  assert.equal(second.retryOf, first.id);
  assert.equal(journals()[0].status, "unknown");
  assert.equal(journals()[1].status, "pending");
  await submitReview(["https://base.example"], quote, 1);
  assert.equal(sent.length, 3);
  assert.equal(journals()[1].hash, hash);
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
    /walletNoResponse/,
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
test("a hash discovered during preparation stays tracked without blocking an explicit retry", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("response lost");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /walletNoResponse/,
  );
  discoveredDuringTarget = true;
  walletFailure = null;
  await submitReview(["https://base.example"], quote, 1);
  assert.equal(sent.length, 2);
  assert.equal(journals()[0].hash, hash);
  assert.equal(journals()[1].status, "pending");
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
    /walletNoResponse/,
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
  await writeJournal({ ...retry, hash, status: "confirmed" });
  assert.equal(journals().find((j) => j.id === retry.id)?.status, "superseded");
  const lateHash = `0x${"cd".repeat(32)}` as const;
  await writeJournal(
    { ...retry, hash: lateHash, status: "pending" },
    false,
    true,
  );
  assert.equal(journals().find((j) => j.id === retry.id)?.status, "pending");
  assert.equal(journals().find((j) => j.id === retry.id)?.hash, lateHash);
  await writeJournal({ ...retry, status: "superseded", resolvedBy: hash });
  assert.equal(journals().find((j) => j.id === retry.id)?.hash, lateHash);
  assert.equal(journals().find((j) => j.id === retry.id)?.status, "pending");
});

test("a silent approval does not hold the prepare lock, block a claim or lose a late hash", async (t) => {
  let complete!: (hash: string) => void;
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const silent = new Promise<string>((resolve) => {
    complete = resolve;
  });
  t.mock.method(provider, "request", async (request: unknown) => {
    sent.push(request);
    return sent.length === 1 ? silent : hash;
  });
  quote = {
    ...quote,
    calls: [{ ...quote.calls[0], kind: "approve" }],
  };
  const controller = new AbortController();
  const first = submitReview(
    ["https://base.example"],
    quote,
    1,
    controller.signal,
    undefined,
    dispatched,
  );
  const abandoned = assert.rejects(first, /reviewCancelled/);
  await started;
  controller.abort();
  await abandoned;
  assert.equal(journals()[0].status, "wallet");
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  const claim = await submitReview(["https://base.example"], quote, 1);
  assert.equal(claim.status, "pending");
  assert.equal(sent.length, 2);
  const lateHash = `0x${"cd".repeat(32)}`;
  complete(lateHash);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(journals()[0].hash, lateHash);
  assert.equal(journals()[0].status, "pending");
  assert.equal(journals()[1].hash, hash);
  assert.equal(sent.length, 2);
});

test("two deliberate actions can reach the wallet while the first response is outstanding", async (t) => {
  let complete!: (hash: string) => void;
  let dispatched!: () => void;
  const started = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const silent = new Promise<string>((resolve) => {
    complete = resolve;
  });
  t.mock.method(provider, "request", async (request: unknown) => {
    sent.push(request);
    return sent.length === 1 ? silent : hash;
  });
  const first = submitReview(
    ["https://base.example"],
    quote,
    1,
    undefined,
    undefined,
    dispatched,
  );
  await started;
  const second = await submitReview(["https://base.example"], quote, 1);
  assert.equal(second.status, "pending");
  assert.equal(sent.length, 2);
  complete(hash);
  await first;
  assert.equal(journals().length, 2);
  assert.equal(sent.length, 2);
});

test("cancelling a slow preflight never opens a later wallet handoff", async (t) => {
  let release!: (gas: bigint) => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  t.mock.method(client, "estimateGas", async () => {
    started();
    return new Promise<bigint>((resolve) => {
      release = resolve;
    });
  });
  const controller = new AbortController();
  let walletRequested = false;
  const cancelled = assert.rejects(
    submitReview(
      ["https://base.example"],
      quote,
      1,
      controller.signal,
      undefined,
      () => {
        walletRequested = true;
      },
    ),
    /reviewCancelled/,
  );
  await began;
  controller.abort();
  await cancelled;
  release(30_000n);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(walletRequested, false);
  assert.equal(sent.length, 0);
  assert.equal(journals().length, 0);
});

const other = "0x3333333333333333333333333333333333333333" as const;
function purchase(
  recipient: `0x${string}` = account,
  bonus = 1,
): Extract<Action, { kind: "purchase" }> {
  return {
    kind: "purchase",
    recipient,
    referrer: realNative.CLUB_REFERRER,
    drawId: 100n,
    unitPrice: 1_000_000n,
    orderId: `order-${bonus}`,
    tickets: [{ numbers: [1, 2, 3, 4, 5], bonus }],
  };
}
test("a smart-account purchase confirms from its own operation inside a shared bundle", async () => {
  const mine = purchase(),
    theirs = purchase(other, 2);
  const [buy] = realNative.actionCalls(mine, 10n ** 12n);
  quote = { ...quote, action: mine, calls: [buy] };
  bundled = bundle([
    {
      sender: other,
      calls: [realNative.actionCalls(theirs, 10n ** 12n)[0]],
      logs: purchaseLogs(theirs, 100n, 5n),
    },
    { sender: account, calls: [buy], logs: purchaseLogs(mine, 100n, 9n) },
  ]);
  const entry = await submitReview(["https://base.example"], quote, 1);
  assert.equal(entry.nonceConfirmed, undefined);
  await reconcile(["https://base.example"], entry);
  const done = journals()[0];
  assert.equal(done.status, "confirmed");
  assert.deepEqual(done.purchaseReceipt?.ticketIds, ["9"]);
  // The bundler's transaction nonce never becomes the account's nonce.
  assert.equal(done.nonce, 7);
  assert.equal(done.nonceConfirmed, undefined);
  assert.equal(sent.length, 1);
});
test("a bundle proves nothing unless this account's own operation carries the reviewed call", async () => {
  const call = quote.calls[0];
  bundled = bundle([
    { sender: account, calls: [{ ...call, data: "0x12345678" }] },
  ]);
  const entry = await submitReview(["https://base.example"], quote, 1);
  await assert.rejects(
    reconcile(["https://base.example"], entry),
    /wrongReplacement/,
  );
  bundled = bundle([{ sender: other, calls: [call] }]);
  await assert.rejects(
    reconcile(["https://base.example"], entry),
    /wrongReplacement/,
  );
  assert.equal(journals()[0].status, "pending");
  bundled = bundle([{ sender: account, calls: [call], success: false }]);
  await reconcile(["https://base.example"], entry);
  assert.equal(journals()[0].status, "reverted");
});
test("hashless recovery finds a bundled claim and reads its payout from that operation alone", async () => {
  quote = {
    ...quote,
    action: { kind: "claim", ids: [1n, 2n] },
    calls: [{ ...quote.calls[0], kind: "claim" }],
  };
  walletFailure = new Error("response lost");
  await assert.rejects(
    submitReview(["https://base.example"], quote, 1),
    /walletNoResponse/,
  );
  bundled = bundle([
    {
      sender: account,
      calls: [{ ...quote.calls[0], data: "0x12345678" }],
      logs: claimLogs(account, 3, 10n),
    },
    {
      sender: account,
      calls: [quote.calls[0]],
      logs: claimLogs(account, 2),
    },
  ]);
  eventCount = 1;
  await findTransactionCandidates(["https://base.example"], journals()[0]);
  assert.deepEqual(journals()[0].recovery?.candidates, [hash]);
  await reconcile(["https://base.example"], journals()[0], hash);
  assert.equal(journals()[0].status, "confirmed");
  assert.deepEqual(journals()[0].claimReceipt?.ticketIds, ["1", "2"]);
  assert.equal(sent.length, 1);
});
