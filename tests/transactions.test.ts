import test from "node:test";
import assert from "node:assert/strict";
import { parseJournal, sameCall } from "../src/transactions.ts";
import { JACKPOT } from "../src/config.ts";
const entry = {
  schema: 1,
  id: "record",
  account: JACKPOT,
  chainId: 8453,
  to: JACKPOT,
  data: "0x30fcc737",
  nonce: 4,
  createdAt: 100,
  kind: "finalize",
  status: "pending",
  hash: `0x${"ab".repeat(32)}`,
};
test("journal decoding is bounded and rejects malformed execution context", () => {
  assert.equal(parseJournal([entry]).length, 1);
  for (const patch of [
    { chainId: 1 },
    { data: "eval()" },
    { hash: "0x1" },
    { nonce: -1 },
    { kind: "buyTickets" },
    { status: "success" },
    { account: "0x1234" },
  ])
    assert.equal(parseJournal([{ ...entry, ...patch }]).length, 0);
  assert.equal(parseJournal(Array(150).fill(entry)).length, 100);
});
test("a successful replacement counts as intended only if destination, calldata and zero value match", () => {
  const a = { to: JACKPOT, data: "0x30fcc737" as const };
  assert.equal(
    sameCall(a, { to: JACKPOT, input: "0x30fcc737", value: 0n }),
    true,
  );
  assert.equal(
    sameCall(a, { to: JACKPOT, input: "0x30fcc738", value: 0n }),
    false,
  );
  assert.equal(
    sameCall(a, { to: JACKPOT, input: "0x30fcc737", value: 1n }),
    false,
  );
  assert.equal(
    sameCall(a, { to: null, input: "0x30fcc737", value: 0n }),
    false,
  );
});

test("vault journals preserve exact native value and chain while rejecting unsafe serialization", () => {
  const eth = {
    ...entry,
    kind: "vaults",
    chainId: 1,
    value: "1000000000000000001",
  };
  assert.equal(parseJournal([eth]).length, 1);
  for (const value of ["-1", "01", "1e18", (2n ** 256n).toString(), 1])
    assert.equal(parseJournal([{ ...eth, value }]).length, 0);
  assert.equal(parseJournal([{ ...eth, chainId: 42161 }]).length, 0);
  assert.equal(
    sameCall(
      { to: JACKPOT, data: "0x30fcc737", value: eth.value },
      { to: JACKPOT, input: "0x30fcc737", value: 1_000_000_000_000_000_001n },
    ),
    true,
  );
  assert.equal(
    sameCall(
      { to: JACKPOT, data: "0x30fcc737", value: eth.value },
      { to: JACKPOT, input: "0x30fcc737", value: 1_000_000_000_000_000_000n },
    ),
    false,
  );
});

test("storage failure retains the memory journal instead of reloading stale persisted state", async (t) => {
  const { journals, forgetUnsubmitted, journalStorageAvailable } = await import(
    "../src/transactions.ts"
  );
  const storage = {
    getItem: () =>
      JSON.stringify([{ ...entry, hash: undefined, status: "wallet" }]),
    setItem: () => {
      throw new Error("quota");
    },
  };
  const descriptors = ["localStorage", "window"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true,
  });
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  assert.equal(journals()[0].status, "wallet");
  forgetUnsubmitted("record");
  assert.equal(journals()[0].status, "rejected");
  assert.equal(journalStorageAvailable(), false);
});
