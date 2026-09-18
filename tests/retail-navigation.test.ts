import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHref } from "../src/navigation.ts";

test("past collection and ticket review links round-trip as inert display state", () => {
  for (const route of [
    { view: "tickets", period: "past" },
    {
      view: "tickets",
      period: "past",
      address: "0x1111111111111111111111111111111111111111",
    },
    { view: "winnings", ticket: "174001" },
  ] as const)
    assert.deepEqual(parseRoute(routeHref(route)), route);
});
test("ticket references are bounded uint256 IDs, never transaction payloads", () => {
  for (const id of [
    "0",
    "-1",
    "1.5",
    "01",
    "0x1234",
    String(2n ** 256n),
    "1".repeat(100),
  ])
    assert.equal(parseRoute(`#winnings?ticket=${id}`).ticket, undefined);
  assert.equal(
    parseRoute(`#winnings?ticket=${2n ** 256n - 1n}`).ticket,
    String(2n ** 256n - 1n),
  );
  assert.equal(parseRoute("#draw?ticket=123").ticket, undefined);
  assert.equal(parseRoute("#tickets?period=past&draw=174").period, undefined);
  assert.equal(parseRoute("#tickets?period=forever").period, undefined);
});

import { LANGUAGES } from "../src/i18n.ts";
import { experienceCopy, experienceKeys } from "../src/experienceCopy.ts";
test("retail copy preserves every value and interpolation in all eight locales", () => {
  for (const lang of LANGUAGES)
    for (const key of experienceKeys) {
      const text = experienceCopy(lang.code)(key);
      assert.ok(text.trim());
      assert.deepEqual(
        [...text.matchAll(/\{\w+\}/g)].map((x) => x[0]).sort(),
        [...experienceCopy("en")(key).matchAll(/\{\w+\}/g)]
          .map((x) => x[0])
          .sort(),
      );
    }
});
