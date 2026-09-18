import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = mkdtempSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "compiler-hash-fixture-",
  ),
);
mkdirSync(path.join(root, "contracts"));
mkdirSync(path.join(root, "node_modules/@openzeppelin/contracts"), {
  recursive: true,
});
writeFileSync(path.join(root, "contracts/Fixture.sol"), "// local source");
for (const [name, content] of [
  ["First.sol", "// first dependency"],
  ["Second.sol", "// second dependency"],
])
  writeFileSync(
    path.join(root, "node_modules/@openzeppelin/contracts", name),
    content,
  );
let reverse = false;
mock.module("solc", {
  defaultExport: {
    version: () => "mock-solc-for-provenance-test",
    compile: (_input, { import: load }) => {
      const names = ["First.sol", "Second.sol"];
      if (reverse) names.reverse();
      for (const name of names) load("@openzeppelin/contracts/" + name);
      return JSON.stringify({ contracts: {}, errors: [] });
    },
  },
});
const { compileContracts } = await import("../scripts/compile-contracts.mjs");
const previous = process.cwd();
process.chdir(root);
after(() => {
  process.chdir(previous);
  rmSync(root, { recursive: true, force: true });
});
test("resolved callback-import content is part of the compiler input hash", () => {
  const before = compileContracts().inputHash;
  writeFileSync(
    "node_modules/@openzeppelin/contracts/First.sol",
    "// modified external dependency",
  );
  const after = compileContracts().inputHash;
  assert.notEqual(before, after);
});
test("callback discovery order does not alter the complete source identity", () => {
  reverse = false;
  const first = compileContracts().inputHash;
  reverse = true;
  assert.equal(compileContracts().inputHash, first);
});
