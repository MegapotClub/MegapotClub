import test from "node:test";
import assert from "node:assert/strict";
import { purchaseReceipt } from "../src/purchaseReceipt.ts";
import { purchaseLogs } from "./fixtures/receipts.ts";
import { CLUB_REFERRER, type Action } from "../src/native.ts";
const order: Extract<Action, { kind: "purchase" }> = {
  kind: "purchase",
  recipient: "0x1111111111111111111111111111111111111111",
  referrer: CLUB_REFERRER,
  drawId: 100n,
  unitPrice: 1_000_001n,
  tickets: [
    { numbers: [1, 2, 3, 4, 5], bonus: 6 },
    { numbers: [6, 7, 8, 9, 10], bonus: 1 },
  ],
};
test("receipt facts accept rollover and record actual count, draw and exact paid amount", () => {
  assert.deepEqual(purchaseReceipt(purchaseLogs(order, 101n), order), {
    draw: "101",
    ticketIds: ["101100", "101101"],
    paid: "2000002",
  });
});
test("success status alone cannot confirm wrong tickets, recipients, emitters or attribution", () => {
  const logs = purchaseLogs(order);
  for (const bad of [
    logs.slice(1),
    [...logs, logs[0]],
    logs.map((l) => ({ ...l, address: order.recipient })),
    purchaseLogs({
      ...order,
      recipient: "0x2222222222222222222222222222222222222222",
    }),
    purchaseLogs({ ...order, referrer: order.recipient }),
    purchaseLogs({
      ...order,
      tickets: [{ numbers: [1, 2, 3, 4, 6], bonus: 6 }, order.tickets[1]],
    }),
  ])
    assert.throws(() => purchaseReceipt(bad, order), /receiptMismatch/);
});
