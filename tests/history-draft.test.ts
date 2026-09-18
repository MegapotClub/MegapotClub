import test from "node:test";
import assert from "node:assert/strict";
import { nativeReturnPpm, formatReturn } from "../src/historyMath.ts";
import { parseActionDraft } from "../src/actionDraft.ts";

test("native performance includes total and partial losses and never invents a zero-base return", () => {
  assert.equal(nativeReturnPpm(100n, 75n), -250_000n);
  assert.equal(nativeReturnPpm(100n, 0n), -1_000_000n);
  assert.equal(nativeReturnPpm(0n, 100n), null);
  assert.equal(nativeReturnPpm(100n, 100n), 0n);
  assert.equal(nativeReturnPpm(1n << 200n, 1n << 201n), 1_000_000n);
  assert.throws(() => nativeReturnPpm(-1n, 10n));
  assert.throws(() => nativeReturnPpm(10n, -1n));
});

test("performance display preserves sign, sub-percent precision and arbitrarily large integer parts", () => {
  assert.equal(formatReturn(-1n, "en"), "−0.0001%");
  assert.equal(formatReturn(-250_000n, "en"), "−25%");
  assert.equal(formatReturn(1_234n, "de"), "0,1234%");
  assert.equal(formatReturn(null, "en"), "—");
  assert.equal(
    formatReturn(90071992547409930001n, "en"),
    "9,007,199,254,740,993.0001%",
  );
});

test("restored action forms accept incomplete input but reject executable or malformed state", () => {
  const draft = { amount: "10.", ids: "1, 2", percentage: 100 };
  assert.deepEqual(parseActionDraft(draft), draft);
  assert.equal(parseActionDraft({ ...draft, amount: "1e9" }), null);
  assert.equal(parseActionDraft({ ...draft, ids: "0xdeadbeef" }), null);
  assert.equal(parseActionDraft({ ...draft, ids: "1".repeat(2401) }), null);
  assert.equal(parseActionDraft({ ...draft, percentage: 100.1 }), null);
  assert.equal(parseActionDraft({ ...draft, percentage: 0 }), null);
  assert.deepEqual(
    parseActionDraft({ ...draft, data: "0xdeadbeef", submit: true }),
    draft,
  );
});
