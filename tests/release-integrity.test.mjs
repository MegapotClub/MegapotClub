import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
import {
  inventory,
  sha256,
  verifyArtifact,
} from "../scripts/release-files.mjs";
import { verifyDeployment } from "../scripts/verify-deployment.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "megapot-integrity-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "en"));
  await fs.writeFile(
    path.join(root, "index.html"),
    "<html>Megapot Club</html>",
  );
  await fs.writeFile(
    path.join(root, "en/index.html"),
    "<html lang=en>Megapot Club</html>",
  );
  await fs.writeFile(path.join(root, "app.js"), "console.log('fixture');");
  await fs.writeFile(
    path.join(root, "release.json"),
    JSON.stringify({
      version: "fixture",
      sourceTreeSha256: sha256("{}"),
      sourceFiles: {},
      assets: await inventory(root),
    }),
  );
  return root;
}

test("release inventory rejects a missing file, added file, tampering and a symlink", async (t) => {
  const root = await fixture(t);
  await verifyArtifact(root);
  const original = await fs.readFile(path.join(root, "app.js"));
  await fs.rm(path.join(root, "app.js"));
  await assert.rejects(verifyArtifact(root), /Missing or unmanifested/);
  await fs.writeFile(path.join(root, "app.js"), original);
  await fs.writeFile(path.join(root, "extra.js"), "extra");
  await assert.rejects(verifyArtifact(root), /Missing or unmanifested/);
  await fs.rm(path.join(root, "extra.js"));
  await fs.writeFile(
    path.join(root, "__proto__"),
    "must not disappear from the inventory",
  );
  await assert.rejects(verifyArtifact(root), /Missing or unmanifested/);
  await fs.rm(path.join(root, "__proto__"));
  await fs.writeFile(path.join(root, "app.js"), "changed");
  await assert.rejects(verifyArtifact(root), /Asset mismatch/);
  await fs.rm(path.join(root, "app.js"));
  await fs.symlink("index.html", path.join(root, "app.js"));
  await assert.rejects(verifyArtifact(root), /Only regular files/);
  await fs.rm(path.join(root, "app.js"));
  await fs.writeFile(path.join(root, "app.js"), original);
  for (const name of ["2", "10", "__proto__"])
    await fs.writeFile(path.join(root, name), name);
  const manifestPath = path.join(root, "release.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.assets = Object.fromEntries(
    Object.entries(await inventory(root)).filter(
      ([name]) => name !== "release.json",
    ),
  );
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await verifyArtifact(root);
});

test("release inventory validates its source digest and rejects escaping asset paths", async (t) => {
  const root = await fixture(t);
  const target = path.join(root, "release.json");
  const manifest = JSON.parse(await fs.readFile(target, "utf8"));
  manifest.sourceTreeSha256 = "0".repeat(64);
  await fs.writeFile(target, JSON.stringify(manifest));
  await assert.rejects(verifyArtifact(root), /Source inventory digest/);
  manifest.assets["../escape"] = manifest.assets["app.js"];
  await fs.writeFile(target, JSON.stringify(manifest));
  await assert.rejects(verifyArtifact(root), /Missing or unmanifested/);
});

async function serve(t, root) {
  const calls = [];
  const state = { mode: "normal", active: 0, maxActive: 0 };
  const server = http.createServer(async (req, res) => {
    calls.push(req.url);
    state.active++;
    state.maxActive = Math.max(state.maxActive, state.active);
    res.on("finish", () => state.active--);
    if (state.mode === "rate-limit") {
      res.writeHead(429, { "Retry-After": "60" });
      return res.end("slow down");
    }
    if (state.mode === "redirect") {
      res.writeHead(302, { Location: "http://127.0.0.1:1/" });
      return res.end();
    }
    if (state.mode === "oversize") return res.end("x".repeat(5000));
    const prefix = "/ipfs/release-fixture/";
    if (!req.url.startsWith(prefix)) {
      res.writeHead(404);
      return res.end();
    }
    let name = req.url.slice(prefix.length);
    if (!name || name.endsWith("/")) name += "index.html";
    if (state.mode === "corrupt" && name === "app.js")
      return res.end("different");
    try {
      res.end(await fs.readFile(path.join(root, name)));
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/ipfs/release-fixture/`,
    state,
    calls,
  };
}

test("deployment check verifies exact bytes under an IPFS-style prefix with serial requests", async (t) => {
  const root = await fixture(t);
  const { url, state, calls } = await serve(t, root);
  const result = await verifyDeployment({ url, artifact: root, interval: 0 });
  assert.equal(result.files, 4);
  assert.equal(result.status, "verified");
  assert.equal(state.maxActive, 1);
  assert.deepEqual(calls, [
    "/ipfs/release-fixture/release.json",
    "/ipfs/release-fixture/app.js",
    "/ipfs/release-fixture/en/",
    "/ipfs/release-fixture/",
  ]);
  state.mode = "corrupt";
  await assert.rejects(
    verifyDeployment({ url, artifact: root, interval: 0 }),
    /app.js/,
  );
});

test("deployment check fails closed on 429, redirects and oversized bodies without retries", async (t) => {
  const root = await fixture(t);
  const { url, state, calls } = await serve(t, root);
  for (const mode of ["rate-limit", "redirect", "oversize"]) {
    state.mode = mode;
    const before = calls.length;
    await assert.rejects(
      verifyDeployment({ url, artifact: root, interval: 0 }),
    );
    assert.equal(calls.length - before, 1, mode);
  }
  await assert.rejects(
    verifyDeployment({ url: "http://example.com/", artifact: root }),
    /Use HTTPS/,
  );
  await assert.rejects(
    verifyDeployment({
      url: "https://name:secret@example.com/",
      artifact: root,
    }),
    /without credentials/,
  );
});
