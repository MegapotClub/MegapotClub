import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { inventory, sha256, verifyArtifact } from "./release-files.mjs";

const root = process.cwd();
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
assert.equal(
  git("status", "--porcelain", "--untracked-files=normal"),
  "",
  "Commit the exact source before preparing a release",
);
const commit = git("rev-parse", "--verify", "HEAD");
const node = (await fs.readFile(".node-version", "utf8")).trim();
const npm = (await fs.readFile(".npm-version", "utf8")).trim();
assert.equal(process.versions.node, node, "Use the pinned Node version");
assert.equal(
  execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  npm,
  "Use the pinned npm version",
);
const out = path.join(root, ".release", commit);
await fs.mkdir(path.dirname(out), { recursive: true });
assert.equal(
  await fs.stat(out).then(
    () => true,
    () => false,
  ),
  false,
  `Release already exists: ${out}`,
);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "megapot-release-"));
const stage = `${out}.partial`;
await fs.mkdir(stage); // Exclusive; never overwrite a previous attempt.
const epoch = git("show", "-s", "--format=%ct", "HEAD");

async function run(command, args, cwd, env, label) {
  console.log(label);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const capture = (chunk) => {
      tail = (tail + chunk.toString()).slice(-16000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${label} failed (${code})\n${tail}`)),
    );
  });
}

try {
  const archive = path.join(temporary, "source.tar");
  execFileSync(
    "git",
    ["archive", "--format=tar", "--output", archive, commit],
    { cwd: root },
  );
  let accepted;
  for (const [index, timezone] of ["UTC", "Pacific/Honolulu"].entries()) {
    const checkout = path.join(temporary, `build-${index + 1}`);
    await fs.mkdir(checkout);
    execFileSync("tar", ["-xf", archive, "-C", checkout]);
    const env = {
      ...process.env,
      TZ: timezone,
      SOURCE_DATE_EPOCH: epoch,
      CLUB_BUILD_COMMIT: commit,
      CI: "true",
      NODE_ENV: "production",
    };
    // Each build gets a fresh install from the same lockfile, reusing npm's cache.
    await run(
      "npm",
      ["ci", "--include=dev", "--no-audit", "--no-fund", "--prefer-offline"],
      checkout,
      env,
      `Build ${index + 1}/2: clean dependency install`,
    );
    if (index === 0) {
      await run(
        "npm",
        ["run", "check"],
        checkout,
        env,
        "Fresh checkout: typecheck and tests",
      );
      await run(
        "npm",
        ["run", "contracts:build"],
        checkout,
        env,
        "Fresh checkout: contract compilation",
      );
    }
    await run(
      "npm",
      ["run", "build"],
      checkout,
      env,
      `Build ${index + 1}/2: production build (${timezone})`,
    );
    await run(
      "npm",
      ["run", "verify:release"],
      checkout,
      env,
      `Build ${index + 1}/2: release verification`,
    );
    const built = path.join(checkout, "dist");
    const { files, manifest: builtManifest } = await verifyArtifact(built);
    assert.equal(
      builtManifest.commit,
      commit,
      "Artifact must name the source commit",
    );
    if (accepted)
      assert.deepEqual(
        files,
        accepted,
        "Clean builds did not produce identical bytes",
      );
    else {
      accepted = files;
      await fs.cp(built, path.join(stage, "site"), { recursive: true });
    }
    // Do not retain two full dependency installations at once.
    await fs.rm(checkout, { recursive: true, force: true });
  }
  const tar = path.join(temporary, "site.tar");
  execFileSync("tar", [
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    "--format=ustar",
    "--mode=u=rwX,go=rX",
    "-cf",
    tar,
    "-C",
    path.join(stage, "site"),
    ".",
  ]);
  const compressed = gzipSync(await fs.readFile(tar), { level: 9 });
  await fs.writeFile(path.join(stage, "site.tar.gz"), compressed);
  const { manifest } = await verifyArtifact(path.join(stage, "site"));
  const provenance = {
    schemaVersion: 1,
    product: "Megapot Club",
    version: manifest.version,
    commit,
    sourceDateEpoch: Number(epoch),
    environment: {
      node,
      npm,
      platform: process.platform,
      architecture: process.arch,
    },
    lockfileSha256: sha256(await fs.readFile("package-lock.json")),
    sourceTreeSha256: manifest.sourceTreeSha256,
    releaseManifestSha256: accepted["release.json"].sha256,
    archiveSha256: sha256(compressed),
    reproducibility: {
      cleanInstalls: 2,
      cleanBuilds: 2,
      timezones: ["UTC", "Pacific/Honolulu"],
      identicalFiles: Object.keys(accepted).length,
    },
    authorization:
      "Build evidence only. Requires separate release acceptance; does not authorize deployment or funded operations.",
  };
  await fs.writeFile(
    path.join(stage, "provenance.json"),
    JSON.stringify(provenance, null, 2) + "\n",
  );
  const sums = await inventory(stage);
  await fs.writeFile(
    path.join(stage, "SHA256SUMS"),
    Object.entries(sums)
      .map(([name, meta]) => `${meta.sha256}  ${name}\n`)
      .join(""),
  );
  assert.equal(
    git("rev-parse", "HEAD"),
    commit,
    "Source changed during release preparation",
  );
  assert.equal(
    git("status", "--porcelain", "--untracked-files=normal"),
    "",
    "Source changed during release preparation",
  );
  await fs.rename(stage, out);
  console.log(
    JSON.stringify(
      { status: "verified", directory: out, ...provenance },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.rm(stage, { recursive: true, force: true });
}
