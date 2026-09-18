import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function assetPath(name) {
  assert.equal(typeof name, "string", "Asset path must be a string");
  assert.ok(/^[A-Za-z0-9_./-]+$/.test(name), `Unsafe asset path: ${name}`);
  assert.ok(
    name.split("/").every((part) => part && !part.startsWith(".")),
    `Unsafe asset path: ${name}`,
  );
  return name;
}

export async function fileNames(root, prefix = "") {
  const names = [];
  for (const entry of await fs.readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assetPath(name);
    if (entry.isDirectory()) names.push(...(await fileNames(root, name)));
    else {
      assert.ok(entry.isFile(), `Only regular files are allowed: ${name}`);
      names.push(name);
    }
  }
  return names.sort();
}

export async function inventory(root) {
  const result = Object.create(null);
  for (const name of await fileNames(root)) {
    const bytes = await fs.readFile(path.join(root, name));
    result[name] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  return result;
}

// The manifest is an integrity inventory, not an authorization or trust root.
// Deployment checks must start with a locally accepted artifact.
export async function verifyArtifact(root) {
  const actual = await inventory(root);
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, "release.json"), "utf8"),
  );
  assert.ok(
    manifest.assets &&
      typeof manifest.assets === "object" &&
      !Array.isArray(manifest.assets),
  );
  assert.deepEqual(
    Object.keys(actual)
      .filter((name) => name !== "release.json")
      .sort(),
    Object.keys(manifest.assets).sort(),
    "Missing or unmanifested assets",
  );
  for (const [name, expected] of Object.entries(manifest.assets)) {
    assetPath(name);
    assert.match(expected.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(expected.bytes) && expected.bytes >= 0);
    assert.deepEqual(actual[name], expected, `Asset mismatch: ${name}`);
  }
  assert.equal(
    manifest.sourceTreeSha256,
    sha256(JSON.stringify(manifest.sourceFiles)),
    "Source inventory digest mismatch",
  );
  return { manifest, files: actual };
}
