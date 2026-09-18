import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
const root = new URL("../src/locales/", import.meta.url);
const en: Record<string, string> = JSON.parse(
  readFileSync(new URL("en.json", root), "utf8"),
);
test("all eight locales translate every key and preserve interpolation variables", () => {
  const files = readdirSync(root);
  assert.equal(files.length, 8);
  for (const file of files) {
    const dictionary = JSON.parse(readFileSync(new URL(file, root), "utf8"));
    assert.deepEqual(
      Object.keys(dictionary).sort(),
      Object.keys(en).sort(),
      file,
    );
    for (const [key, value] of Object.entries(en)) {
      assert.equal(typeof dictionary[key], "string");
      assert.ok(dictionary[key].length);
      assert.deepEqual(
        [...dictionary[key].matchAll(/\{\w+\}/g)]
          .map((m: RegExpMatchArray) => m[0])
          .sort(),
        [...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
        `${file}:${key}`,
      );
    }
  }
});
