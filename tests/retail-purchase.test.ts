import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePurchaseDraft, purchaseIntent } from "../src/purchaseDraft.ts";
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
const wallet = "0x1111111111111111111111111111111111111111";
test("purchase intent preserves exact price, selections and referral without authorization fields", () => {
  const intent = purchaseIntent(draft, draw, wallet, wallet);
  assert.equal(intent.total, "2000002");
  assert.equal(intent.referrer, wallet);
  assert.equal(intent.quantity, 2);
  assert.deepEqual(intent.selections, draft.rows);
  assert.equal("signature" in intent, false);
  assert.equal("transactionHash" in intent, false);
  assert.equal(
    purchaseIntent({ ...draft, mode: "quick" }, draw).selections,
    null,
  );
  assert.equal(
    purchaseIntent({ ...draft, mode: "quick" }, draw).total,
    "3000003",
  );
});
test("malformed drafts and changed draws cannot become purchase intents", () => {
  for (const bad of [
    { ...draft, quantity: 0 },
    { ...draft, quantity: 101 },
    { ...draft, quantity: Infinity },
    { ...draft, rows: [] },
    { ...draft, rows: [{ numbers: [1, 1, 2, 3, 4], bonus: 1 }] },
    { ...draft, rows: [{ numbers: [1, 2, 3, 4, 31], bonus: 1 }] },
    { ...draft, rows: [{ numbers: [1, 2, 3, 4, 5], bonus: 11 }] },
  ])
    assert.equal(parsePurchaseDraft(bad, draw), null);
  assert.throws(() => purchaseIntent({ ...draft, draw: "177" }, draw));
  assert.throws(() =>
    purchaseIntent(draft, draw, wallet, "javascript:alert(1)"),
  );
  assert.throws(() =>
    purchaseIntent({ ...draft, rows: [{ numbers: [], bonus: 1 }] }, draw),
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
    { view: "play" },
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
