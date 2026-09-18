import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import assert from "node:assert/strict";
import { sha256, verifyArtifact } from "./release-files.mjs";

export async function verifyDeployment({
  url,
  artifact,
  quick = false,
  timeout = 10000,
  interval = 100,
}) {
  const base = new URL(url);
  assert.ok(
    base.protocol === "https:" ||
      (base.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)),
    "Use HTTPS (HTTP is only allowed for a local verification fixture)",
  );
  assert.ok(
    !base.username && !base.password && !base.search && !base.hash,
    "Use a base URL without credentials, query or fragment",
  );
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const { manifest, files } = await verifyArtifact(artifact);
  const names = [
    "release.json",
    ...Object.keys(files).filter(
      (name) =>
        name !== "release.json" &&
        (!quick ||
          name.endsWith(".html") ||
          name === "config.json" ||
          name === "theme-init.js"),
    ),
  ];
  const started = performance.now();
  let bytes = 0;
  for (const [index, name] of names.entries()) {
    if (index) await pause(interval);
    const target = new URL(
      name === "index.html" ? "./" : name.replace(/\/index\.html$/, "/"),
      base,
    );
    // Fixed local inventory; no links or redirects from the server are followed.
    const expected = files[name];
    const response = await fetch(target, {
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `${name}: HTTP ${response.status}${response.status === 429 ? "; stopped without retry; respect the provider cooldown" : ""}`,
      );
    }
    const chunks = [];
    let received = 0;
    for await (const chunk of response.body) {
      received += chunk.length;
      assert.ok(
        received <= expected.bytes,
        `${name}: oversized or substituted response`,
      );
      chunks.push(chunk);
    }
    assert.equal(received, expected.bytes, `${name}: byte count mismatch`);
    assert.equal(
      sha256(Buffer.concat(chunks)),
      expected.sha256,
      `${name}: content differs from accepted artifact`,
    );
    bytes += received;
  }
  return {
    status: "verified",
    url: base.href,
    version: manifest.version,
    releaseManifestSha256: files["release.json"].sha256,
    mode: quick ? "entrypoints" : "all-assets",
    files: names.length,
    bytes,
    elapsedMs: Math.round(performance.now() - started),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        url: { type: "string" },
        artifact: { type: "string" },
        quick: { type: "boolean", default: false },
      },
    });
    assert.ok(
      values.url && values.artifact,
      "Usage: npm run verify:deployment -- --url https://chosen-host/ --artifact path/to/accepted/site [--quick]",
    );
    console.log(JSON.stringify(await verifyDeployment(values)));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", error: error.message }));
    process.exitCode = 1;
  }
}
