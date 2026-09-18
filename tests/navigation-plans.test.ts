import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHref, normalNavigation } from "../src/navigation.ts";
import { quickPick, validNumbers } from "../src/plans.ts";
import { clubCopy, clubKeys } from "../src/clubCopy.ts";
import { LANGUAGES } from "../src/i18n.ts";
import { retailCopy, retailKeys } from "../src/retailCopy.ts";
test("deep views round-trip through safe fragment URLs", () => {
  const route = {
    view: "lp",
    tab: "vaults",
    product: "l1-eth",
    address: "0x1111111111111111111111111111111111111111",
  } as const;
  assert.deepEqual(parseRoute(routeHref(route)), route);
  assert.deepEqual(parseRoute("#results/175"), {
    view: "results",
    draw: "175",
  });
  assert.deepEqual(
    parseRoute(
      "#tickets?draw=-3&address=garbage&call=0xdead&rpc=https://secret&detail=sign",
    ),
    { view: "tickets" },
  );
  assert.equal(routeHref(parseRoute("#wat?to=0x123")), "#draw");
  assert.deepEqual(parseRoute("#lp?tab=position&product=base-usdc"), {
    view: "lp",
    tab: "position",
    product: "base-usdc",
  });
  assert.deepEqual(
    parseRoute(routeHref({ view: "winnings", section: "refunds" })),
    { view: "winnings", section: "refunds" },
  );
  assert.deepEqual(parseRoute("#winnings?section=sign&to=0xdead&call=0x123"), {
    view: "winnings",
  });
  assert.deepEqual(parseRoute("#tickets?section=refunds"), { view: "tickets" });
});
test("modified and middle link clicks retain browser behavior", () => {
  const e = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  assert.equal(normalNavigation(e), true);
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"])
    assert.equal(normalNavigation({ ...e, [key]: true }), false);
  assert.equal(normalNavigation({ ...e, button: 1 }), false);
});
test("random plans are bounded and unique across small and maximum ranges", () => {
  for (const max of [5, 30, 255])
    for (let i = 0; i < 200; i++) {
      const p = quickPick(max, max);
      assert.equal(validNumbers(p.numbers, p.bonus, max, max), true);
    }
  assert.throws(() => quickPick(4, 1));
  assert.throws(() => quickPick(30, 256));
});
test("all action, recovery, plan and error messages exist in all eight locales", () => {
  for (const locale of LANGUAGES)
    for (const key of clubKeys)
      assert.ok(clubCopy(locale.code)(key)?.length, `${locale.code}:${key}`);
  for (const locale of LANGUAGES)
    for (const key of retailKeys)
      assert.ok(retailCopy(locale.code)(key)?.length, `${locale.code}:${key}`);
});
