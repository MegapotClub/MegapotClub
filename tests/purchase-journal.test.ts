import { test, after } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, keccak256 } from "viem";
import {
  actionCalls,
  jackpotAbi,
  CLUB_REFERRER,
  type Action,
} from "../src/native.ts";
import {
  parseJournal,
  writeJournal,
  journals,
  storedPurchase,
  restorePurchase,
  JOURNAL_KEY,
  type Journal,
} from "../src/transactions.ts";
import { emptyDraft, purchaseDraftKey } from "../src/purchaseDraft.ts";
import { createLocks } from "./fixtures/locks.ts";
const account = "0x1111111111111111111111111111111111111111" as const;
const inviter = "0x2222222222222222222222222222222222222222" as const;
const storage = new Map<string, string>();
const descriptors = ["window", "localStorage", "navigator"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
Object.defineProperty(globalThis, "window", {
  value: new EventTarget(),
  configurable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
  configurable: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: { locks: createLocks() },
  configurable: true,
});
after(() => {
  for (const [key, value] of descriptors) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function order(
  count: number,
  referrer = inviter,
): Extract<Action, { kind: "purchase" }> {
  return {
    kind: "purchase",
    recipient: account,
    referrer,
    drawId: 100n,
    unitPrice: 1_000_000n,
    orderId: `order-${count}`,
    tickets: Array.from({ length: count }, (_, i) => ({
      numbers: [1, 2, 3, 4, 5],
      bonus: (i % 10) + 1,
    })),
  };
}
function row(count: number, id = `purchase-${count}`): Journal {
  const action = order(count),
    call = actionCalls(action, 1_000_000_000n)[0];
  return {
    schema: 2,
    id,
    account,
    chainId: 8453,
    to: call.to,
    data: call.data,
    kind: "purchase",
    purchase: storedPurchase(action),
    nonce: 1,
    createdAt: Date.now(),
    status: "pending",
  };
}
test("actual 1/10/13/14/100-ticket payloads persist through storage, reload and immutable order restoration", async () => {
  storage.clear();
  for (const count of [1, 10, 13, 14, 100]) {
    const entry = row(count);
    await writeJournal(entry, true);
    const decoded = parseJournal(JSON.parse(storage.get(JOURNAL_KEY)!)).find(
      (e) => e.id === entry.id,
    )!;
    assert.equal(decoded.callHash, keccak256(entry.data!));
    assert.equal(decoded.data, undefined);
    assert.equal(restorePurchase(decoded.purchase)?.tickets.length, count);
    const call = actionCalls(
      restorePurchase(decoded.purchase)!,
      1_000_000_000n,
    )[0];
    const args = decodeFunctionData({ abi: jackpotAbi, data: call.data });
    assert.equal(args.functionName, "buyTickets");
    if (args.functionName === "buyTickets") {
      assert.equal(args.args[0].length, count);
      assert.equal(args.args[2][0].toLowerCase(), inviter);
    }
    if (count === 100) {
      assert.equal((entry.data!.length - 2) / 2, 29124);
      assert.ok(JSON.stringify(decoded).length < 6000);
    }
  }
  assert.equal(journals().length, 5);
});
test("a tampered stored referrer cannot be restored under the original canonical call hash", () => {
  const entry = row(100);
  assert.equal(
    parseJournal([
      { ...entry, purchase: { ...entry.purchase, referrer: CLUB_REFERRER } },
    ]).length,
    0,
  );
  assert.equal(parseJournal([{ ...entry, to: inviter }]).length, 0);
});
test("concurrent receipt updates and a new reservation cannot drop either record", async () => {
  storage.clear();
  const old = row(10, "old"),
    next = row(100, "new");
  await writeJournal(old, true);
  await Promise.all([
    writeJournal({ ...old, status: "confirmed" }),
    writeJournal({ ...next, status: "wallet" }, true),
  ]);
  assert.equal(journals().find((e) => e.id === "old")?.status, "confirmed");
  assert.equal(journals().find((e) => e.id === "new")?.status, "wallet");
  await writeJournal({ ...old, status: "pending" });
  assert.equal(journals().find((e) => e.id === "old")?.status, "confirmed");
});
test("resolved history is compacted before any unresolved large purchase", () => {
  const pending = row(100, "old-pending");
  const records = [
    pending,
    ...Array.from({ length: 100 }, (_, i) => ({
      ...row(1, `resolved-${i}`),
      status: "confirmed" as const,
    })),
  ];
  const parsed = parseJournal(records);
  assert.equal(parsed.length, 61);
  assert.equal(parsed.find((e) => e.id === pending.id)?.status, "pending");
});
test("a completed default purchase and a fresh identical selection have distinct journeys", () => {
  const first = emptyDraft("100"),
    second = emptyDraft("100");
  assert.notEqual(purchaseDraftKey(first), purchaseDraftKey(second));
  assert.notEqual(
    purchaseDraftKey(first),
    purchaseDraftKey({ ...first, revision: 2 }),
  );
  assert.equal(
    purchaseDraftKey(first),
    purchaseDraftKey({ ...first, draw: "101" }),
  );
});

test("a stale recovery write cannot erase a known hash or wallet-selected nonce", async () => {
  storage.clear();
  const original = {
    ...row(100, "known-hash"),
    recovery: { fromBlock: "100", nextBlock: "100", candidates: [] },
  };
  await writeJournal(original, true);
  const hash = `0x${"ab".repeat(32)}` as const;
  await writeJournal({ ...original, hash, nonce: 17, nonceConfirmed: true });
  await writeJournal({
    ...original,
    recovery: { ...original.recovery, nextBlock: "200" },
  });
  assert.equal(journals()[0].hash, hash);
  assert.equal(journals()[0].nonce, 17);
  assert.equal(journals()[0].recovery?.nextBlock, "200");
});
