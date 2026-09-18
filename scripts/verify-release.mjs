import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { APP_NAME, ORIGIN, VERSION } from "../src/config.ts";
import { verifyArtifact } from "./release-files.mjs";

const root = path.resolve("dist");
await verifyArtifact(root);
const manifest = JSON.parse(
  await fs.readFile(path.join(root, "release.json"), "utf8"),
);
assert.equal(manifest.name, APP_NAME);
assert.equal(manifest.version, VERSION);
assert.ok(manifest.commit === null || /^[0-9a-f]{40}$/.test(manifest.commit));
if (process.env.CLUB_BUILD_COMMIT)
  assert.equal(manifest.commit, process.env.CLUB_BUILD_COMMIT);
const card = await fs.readFile(path.join(root, "og.png"));
assert.equal(card.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
assert.equal(card.readUInt32BE(16), 1734);
assert.equal(card.readUInt32BE(20), 907);
assert.ok(
  card.length < 5_000_000,
  "Social image must remain small enough for crawlers",
);
for (let offset = 8; offset < card.length; ) {
  const size = card.readUInt32BE(offset);
  const type = card.subarray(offset + 4, offset + 8).toString("ascii");
  assert.ok(
    [
      "IHDR",
      "PLTE",
      "IDAT",
      "IEND",
      "tRNS",
      "gAMA",
      "cHRM",
      "sRGB",
      "iCCP",
    ].includes(type),
    "Social image must not contain authoring or text metadata",
  );
  offset += size + 12;
}
const locales = ["en", "es", "pt-BR", "fr", "de", "zh-CN", "ja", "ko"];
for (const locale of ["", ...locales]) {
  const file = path.join(root, locale, "index.html");
  const html = await fs.readFile(file, "utf8");
  const messages = JSON.parse(
    await fs.readFile(`src/locales/${locale || "en"}.json`, "utf8"),
  );
  assert.ok(html.includes(`<title>${messages.title}</title>`), file);
  assert.ok(html.includes(`lang="${locale || "en"}"`), file);
  assert.ok(html.includes(`content="${ORIGIN}/og.png"`), file);
  const canonical = `${ORIGIN}/${locale ? locale + "/" : ""}`;
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), file);
  assert.ok(html.includes(`property="og:url" content="${canonical}"`), file);
  assert.ok(
    html.includes('name="twitter:card" content="summary_large_image"'),
    file,
  );
  assert.ok(
    html.includes('property="og:image:type" content="image/png"'),
    file,
  );
  assert.ok(!html.includes("noindex"), file);
  assert.ok(
    html.includes("Content-Security-Policy") &&
      html.includes("connect-src 'self' https:"),
    file,
  );
  assert.ok(
    html.includes('id="prize-title"') && !html.includes("<!--app-html-->"),
    file,
  );
  assert.ok(!/Mega[P]ot/.test(html), file);
  assert.ok(html.includes("img-src 'self' data: https:"), file);
  assert.ok(html.includes("script-src 'self' 'report-sample';"), file);
  for (const [, attributes, body] of html.matchAll(
    /<script([^>]*)>([\s\S]*?)<\/script>/g,
  ))
    assert.ok(
      /\bsrc=/.test(attributes) ||
        /type="application\/json"/.test(attributes) ||
        !body.trim(),
      `unexpected executable inline script: ${file}`,
    );
  for (const [, ref] of html.matchAll(/(?:src|href)="(\.{1,2}\/[^"#]+)"/g)) {
    const target = path.resolve(path.dirname(file), ref);
    assert.ok(target.startsWith(`${root}/`), ref);
    await fs.access(target);
  }
}
async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory()
          ? files(path.join(dir, e.name))
          : path.join(dir, e.name),
      ),
    )
  ).flat();
}
for (const file of await files(root)) {
  const name = path.relative(root, file).replaceAll(path.sep, "/");
  assert.ok(!/\.(?:map|tsx?|mdx)$/.test(name), name);
  assert.ok(
    !/(?:^|\/)(?:AGENTS\.md|CONTRACTS|README\.md|VALIDATION\.md|POLICY-REVIEW\.md|\.env(?:\..*)?)$/.test(
      name,
    ),
    name,
  );
  if (name === "release.json") continue;
  const bytes = await fs.readFile(file);
  assert.equal(manifest.assets[name]?.bytes, bytes.length, name);
  assert.equal(
    manifest.assets[name]?.sha256,
    createHash("sha256").update(bytes).digest("hex"),
    name,
  );
  if (/\.(?:html|json|txt|md|js|css|svg)$/.test(name)) {
    const text = bytes.toString("utf8");
    assert.ok(!/Mega[P]ot/.test(text), name);
    assert.ok(!text.includes("@cc "), name);
  }
}
for (const [file, hash] of Object.entries(manifest.sourceFiles))
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex"),
    hash,
    file,
  );
console.log(
  `Verified ${locales.length + 1} static entrypoints, branding, provenance, relative assets and public-artifact boundaries.`,
);
