import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePurchaseDraft, purchaseAction } from "../src/purchaseDraft.ts";
import { parseRoute, routeHref } from "../src/navigation.ts";
import { parseIndexedWins } from "../src/megapotApi.ts";
import type { Draw } from "../src/model.ts";
const draw: Draw = {
  id: "178",
  prizePool: "100000000",
  ticketPrice: "1000001",
  ticketCount: "0",
  closesAt: 2000000000,
  locked: false,
  settled: false,
  ballMax: 30,
  bonusMax: 10,
  result: null,
};
const draft = {
  schema: 1 as const,
  draw: "178",
  quantity: 3,
  mode: "choose" as const,
  rows: [
    { numbers: [1, 2, 3, 4, 5], bonus: 6 },
    { numbers: [6, 7, 8, 9, 10], bonus: 1 },
  ],
};
const wallet = "0x1111111111111111111111111111111111111111" as const;
const chosenRows = [
  { numbers: [5, 1, 30, 22, 9], bonus: 10 },
  { numbers: [1, 2, 3, 4, 5], bonus: 1 },
];
test("purchase actions carry exact price, selections and the buyer without authorization fields", () => {
  const action = purchaseAction(draft, draw, wallet);
  assert.equal(action.kind, "purchase");
  assert.equal(action.unitPrice * BigInt(action.tickets.length), 2000002n);
  assert.equal(action.recipient, wallet);
  assert.equal(action.tickets.length, 2);
  assert.deepEqual(action.tickets, draft.rows);
  assert.equal("signature" in action, false);
  assert.equal("transactionHash" in action, false);
  assert.equal(
    purchaseAction({ ...draft, mode: "quick" }, draw, wallet).tickets.length,
    3,
  );
});
test("malformed drafts cannot become purchases; draw rollover preserves selections", () => {
  for (const bad of [
    { ...draft, quantity: 0 },
    { ...draft, quantity: 101 },
    { ...draft, quantity: Infinity },
    { ...draft, rows: [] },
    { ...draft, rows: [{ numbers: [1, 1, 2, 3, 4], bonus: 1 }] },
    { ...draft, rows: [{ numbers: [1, 2, 3, 4, 256], bonus: 1 }] },
    { ...draft, rows: [{ numbers: [1, 2, 3, 4, 5], bonus: 256 }] },
  ])
    assert.equal(parsePurchaseDraft(bad, draw), null);
  assert.deepEqual(
    purchaseAction({ ...draft, draw: "177" }, draw, wallet).tickets,
    draft.rows,
  );
  assert.throws(() =>
    purchaseAction(
      { ...draft, rows: [{ numbers: [], bonus: 1 }] },
      draw,
      wallet,
    ),
  );
  assert.throws(() =>
    purchaseAction({ ...draft, mode: "quick", quantity: 101 }, draw, wallet),
  );
});
test("retired Plans and new retail links restore only inert bounded state", () => {
  assert.deepEqual(parseRoute("#plans"), { view: "play" });
  for (const route of [
    { view: "play", choose: true, checkout: true, ref: wallet },
    { view: "invite" },
    { view: "results", draw: "177", resultTab: "prizes" },
    { view: "draw", detail: "profile" },
  ] as const)
    assert.deepEqual(parseRoute(routeHref(route)), route);
  assert.deepEqual(
    parseRoute("#play?confirmed=1&send=1&hash=0xabc&ref=javascript:bad"),
    { view: "play", ref: "javascript:bad" },
  );
});
test("indexed wins are wallet/draw scoped and claimed amounts cannot be invented", () => {
  const win = {
    id: "1",
    wallet,
    round_id: "177",
    user_ticket_id: "123",
    amount: { amount: "123456789012345678", decimals: 6 },
    claimed: true,
    claimed_tx_hash: "0x" + "ab".repeat(32),
    normals: [1, 2, 3, 4, 5],
    bonusball: 6,
  };
  assert.equal(
    parseIndexedWins({ data: [win] }, { account: wallet, claimed: true })[0]
      .amount.amount,
    win.amount.amount,
  );
  for (const bad of [
    { ...win, wallet: "0x" + "22".repeat(20) },
    { ...win, claimed_tx_hash: null },
    { ...win, amount: { amount: "1e8", decimals: 6 } },
    { ...win, normals: [1, 1, 2, 3, 4] },
  ])
    assert.throws(() =>
      parseIndexedWins({ data: [bad] }, { account: wallet, claimed: true }),
    );
  assert.throws(() => parseIndexedWins({ data: [win] }, { draw: "176" }));
});
test("every retail locale has complete keys and matching interpolation", () => {
  const en = JSON.parse(
    readFileSync(
      new URL("../src/retail-locales/en.json", import.meta.url),
      "utf8",
    ),
  );
  for (const locale of ["es", "pt-BR", "fr", "de", "zh-CN", "ja", "ko"]) {
    const copy = JSON.parse(
      readFileSync(
        new URL(`../src/retail-locales/${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      assert.ok(copy[key].trim());
      assert.deepEqual(
        [...copy[key].matchAll(/\{\w+\}/g)].map((x) => x[0]).sort(),
        [...en[key].matchAll(/\{\w+\}/g)].map((x) => x[0]).sort(),
      );
    }
  }
});
test("draft orders keep the displayed price and draw, and quick play draws bounded local numbers", () => {
  const chosen = purchaseAction(
    {
      schema: 1,
      draw: "178",
      quantity: 7,
      mode: "choose",
      rows: chosenRows,
    },
    draw,
    wallet,
  );
  assert.equal(chosen.unitPrice, 1_000_001n);
  assert.equal(chosen.drawId, 178n);
  assert.equal(chosen.recipient, wallet);
  assert.deepEqual(
    chosen.tickets.map((t) => t.numbers),
    [
      [1, 5, 9, 22, 30],
      [1, 2, 3, 4, 5],
    ],
  );
  let counter = 0;
  const quick = purchaseAction(
    {
      schema: 1,
      draw: "178",
      quantity: 3,
      mode: "quick",
      rows: [{ numbers: [], bonus: 1 }],
    },
    draw,
    wallet,
    (array) => {
      array[0] = counter++;
      return array;
    },
  );
  assert.equal(quick.tickets.length, 3);
  for (const t of quick.tickets) {
    assert.equal(new Set(t.numbers).size, 5);
    assert.ok(t.numbers.every((n) => n >= 1 && n <= 30));
    assert.ok(t.bonus >= 1 && t.bonus <= 10);
  }
  assert.equal(
    purchaseAction(
      { schema: 1, draw: "177", quantity: 1, mode: "quick", rows: [] },
      draw,
      wallet,
    ).tickets.length,
    1,
  );
  assert.throws(() =>
    purchaseAction(
      {
        schema: 1,
        draw: "178",
        quantity: 1,
        mode: "choose",
        rows: [{ numbers: [], bonus: 1 }],
      },
      draw,
      wallet,
    ),
  );
  assert.throws(() =>
    purchaseAction(
      { schema: 1, draw: "178", quantity: 1, mode: "quick", rows: [] },
      draw,
      "0xabc" as never,
    ),
  );
});
