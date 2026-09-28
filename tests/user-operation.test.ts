import { test } from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { actionCalls, CLUB_REFERRER, type Action } from "../src/native.ts";
import { purchaseReceipt } from "../src/purchaseReceipt.ts";
import { accountOperations, bundledCalls } from "../src/userOperation.ts";
import { JACKPOT } from "../src/config.ts";
import { purchaseLogs } from "./fixtures/receipts.ts";
import { bundle, ENTRY_POINT_V07 } from "./fixtures/userOperations.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const other = "0x3333333333333333333333333333333333333333" as const;
function order(
  recipient: Address,
  bonus = 1,
): Extract<Action, { kind: "purchase" }> {
  return {
    kind: "purchase",
    recipient,
    referrer: CLUB_REFERRER,
    drawId: 100n,
    unitPrice: 1_000_000n,
    orderId: `order-${bonus}`,
    tickets: [{ numbers: [1, 2, 3, 4, 5], bonus }],
  };
}
const buy = (action: Extract<Action, { kind: "purchase" }>) =>
  actionCalls(action, 10n ** 12n)[0];

test("a shared bundle yields only the account's operation with its own receipt logs", () => {
  const mine = order(account),
    theirs = order(other, 2);
  const { tx, receipt } = bundle([
    {
      sender: other,
      calls: [buy(theirs)],
      logs: purchaseLogs(theirs, 100n, 5n),
    },
    { sender: account, calls: [buy(mine)], logs: purchaseLogs(mine, 100n, 9n) },
  ]);
  assert.throws(() => purchaseReceipt(receipt.logs, mine), /receiptMismatch/);
  const ops = accountOperations(tx, receipt, account);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].success, true);
  assert.deepEqual(ops[0].calls, [
    { to: JACKPOT, value: 0n, input: buy(mine).data },
  ]);
  assert.deepEqual(purchaseReceipt(ops[0].logs, mine).ticketIds, ["9"]);
  assert.deepEqual(
    bundledCalls(tx, other).map((call) => call.input),
    [buy(theirs).data],
  );
});

test("batched calls and packed v0.7 operations decode to the same account calls", () => {
  const mine = order(account);
  const [approve, purchase] = actionCalls(mine);
  for (const entryPoint of [undefined, ENTRY_POINT_V07]) {
    const { tx, receipt } = bundle(
      [{ sender: account, calls: [approve, purchase], success: false }],
      entryPoint,
    );
    const [op] = accountOperations(tx, receipt, account);
    assert.equal(op.success, false);
    assert.deepEqual(
      op.calls.map((call) => call.input),
      [approve.data, purchase.data],
    );
    assert.deepEqual(bundledCalls(tx, account), op.calls);
  }
});

test("mismatched or unrecognized bundles are never attributed", () => {
  const call = buy(order(account));
  const pair = bundle([
    { sender: other, calls: [call] },
    { sender: account, calls: [call] },
  ]);
  const swapped = bundle([
    { sender: account, calls: [call] },
    { sender: other, calls: [call] },
  ]);
  // Missing or reordered EntryPoint outcomes leave every operation unattributed.
  assert.deepEqual(
    accountOperations(
      pair.tx,
      { logs: pair.receipt.logs.slice(0, -1) },
      account,
    ),
    [],
  );
  assert.deepEqual(accountOperations(pair.tx, swapped.receipt, account), []);
  // Only canonical EntryPoints and known account encodings count.
  assert.deepEqual(
    accountOperations({ ...pair.tx, to: JACKPOT }, pair.receipt, account),
    [],
  );
  assert.deepEqual(bundledCalls({ ...pair.tx, to: JACKPOT }, account), []);
  const unknown = bundle([{ sender: account, calls: call.data }]);
  assert.deepEqual(bundledCalls(unknown.tx, account), []);
  assert.deepEqual(
    accountOperations(unknown.tx, unknown.receipt, account)[0].calls,
    [],
  );
});
