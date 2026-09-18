import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { render } from "../.build/ssr/entry-server.js";

import { ORIGIN as origin, VERSION, APP_NAME } from "../src/config.ts";
const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
if (pkg.version !== VERSION) throw new Error("Release versions disagree");
const locales = ["en", "es", "pt-BR", "fr", "de", "zh-CN", "ja", "ko"];
const socialLocales = {
  en: "en_US",
  es: "es_ES",
  "pt-BR": "pt_BR",
  fr: "fr_FR",
  de: "de_DE",
  "zh-CN": "zh_CN",
  ja: "ja_JP",
  ko: "ko_KR",
};
const template = await fs.readFile("dist/index.html", "utf8");
const snapshot = JSON.parse(await fs.readFile("src/snapshot.json", "utf8"));
const escape = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
for (const route of ["", ...locales]) {
  const locale = route || "en";
  const messages = JSON.parse(
    await fs.readFile(`src/locales/${locale}.json`, "utf8"),
  );
  const rootPath = route ? "../" : "./";
  const url = `${origin}/${route ? route + "/" : ""}`;
  const props = { locale, messages, rootPath };
  const metadata = `<title>${escape(messages.title)}</title><meta name="description" content="${escape(messages.description)}"/><link rel="canonical" href="${url}"/><meta property="og:type" content="website"/><meta property="og:site_name" content="${APP_NAME}"/><meta property="og:title" content="${escape(messages.title)}"/><meta property="og:description" content="${escape(messages.description)}"/><meta property="og:url" content="${url}"/><meta property="og:locale" content="${socialLocales[locale]}"/><meta property="og:image" content="${origin}/og.png"/><meta property="og:image:type" content="image/png"/><meta property="og:image:width" content="1734"/><meta property="og:image:height" content="907"/><meta property="og:image:alt" content="${APP_NAME} — ${escape(messages.independent)}"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${escape(messages.title)}"/><meta name="twitter:description" content="${escape(messages.description)}"/><meta name="twitter:image" content="${origin}/og.png"/><meta name="twitter:image:alt" content="${APP_NAME} — ${escape(messages.independent)}"/><link rel="alternate" hreflang="x-default" href="${origin}/"/>${locales.map((l) => `<link rel="alternate" hreflang="${l}" href="${origin}/${l}/"/>`).join("")}`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'report-sample'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https: wss://www.walletlink.org; object-src 'none'; base-uri 'none'; form-action 'none'"/><meta name="referrer" content="no-referrer"/>`;
  const html = template
    .replace('lang="en"', `lang="${locale}"`)
    .replaceAll('"./assets/', `"${rootPath}assets/`)
    .replace('"./favicon.svg"', `"${rootPath}favicon.svg"`)
    .replace('"./theme-init.js"', `"${rootPath}theme-init.js"`)
    .replace("<!--metadata-->", csp + metadata)
    .replace("<!--app-html-->", render(props))
    .replace(
      "<!--initial-data-->",
      JSON.stringify(props).replaceAll("<", "\\u003c"),
    );
  const dir = path.join("dist", route);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), html);
}
await fs.copyFile("src/snapshot.json", "dist/snapshot.json");
await fs.copyFile("LICENSE", "dist/LICENSE.txt");
const lock = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
const notices = [
  "Third-party notices — Megapot Club\nOriginal application: MIT. Each dependency retains its own license.\n",
];
for (const [name, pkg] of Object.entries(lock.packages)) {
  if (!name || pkg.dev) continue;
  notices.push(
    `\n${name.replace(/^node_modules\//, "")} ${pkg.version ?? ""} — ${pkg.license ?? "See package license"}\n`,
  );
  for (const filename of [
    "LICENSE",
    "LICENSE.txt",
    "LICENSE.md",
    "license",
    "license.txt",
    "OFL.txt",
  ]) {
    try {
      notices.push(await fs.readFile(path.join(name, filename), "utf8"));
      break;
    } catch {}
  }
}
await fs.writeFile("dist/third-party-notices.txt", notices.join("\n"));
await fs.writeFile(
  "dist/robots.txt",
  `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
);
await fs.writeFile(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", ...locales.map((l) => l + "/")].map((r) => `<url><loc>${origin}/${r}</loc></url>`).join("")}</urlset>`,
);
await fs.writeFile(
  "dist/llms.txt",
  `# Megapot Club

Independent community app for Megapot.

- [Product guide](${origin}/agents.md)
- [Public snapshot](${origin}/snapshot.json)
- [Release manifest](${origin}/release.json)
`,
);
await fs.copyFile("docs/product-guide.md", "dist/agents.md");
let commit = process.env.CLUB_BUILD_COMMIT ?? null;
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* A source archive can build without Git. Release preparation supplies the revision. */
  }
}
if (commit !== null && !/^[0-9a-f]{40}$/.test(commit))
  throw new Error("Invalid source revision");
async function files(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((i) =>
        i.isDirectory()
          ? files(path.join(dir, i.name))
          : path.join(dir, i.name),
      ),
    )
  ).flat();
}
const assets = Object.create(null);
for (const filename of (await files("dist")).sort()) {
  const content = await fs.readFile(filename);
  assets[filename.slice(5)] = {
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.length,
  };
}
const inputPaths = [
  ...(await files("src")),
  ...(await files("contracts")).filter((file) => file.endsWith(".sol")),
  ...(await files("public")),
  ...(await files("scripts")),
  ...(await files("tests")),
  "package.json",
  "package-lock.json",
  ".node-version",
  ".npm-version",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  "LICENSE",
  "README.md",
  "docs/product-guide.md",
  "THIRD-PARTY-NOTICES.md",
].sort();
const sourceFiles = Object.create(null);
for (const filename of inputPaths)
  sourceFiles[filename] = createHash("sha256")
    .update(await fs.readFile(filename))
    .digest("hex");
const sourceTreeSha256 = createHash("sha256")
  .update(JSON.stringify(sourceFiles))
  .digest("hex");
await fs.writeFile(
  "dist/release.json",
  JSON.stringify(
    {
      name: APP_NAME,
      commit,
      version: VERSION,
      license: "MIT",
      snapshotBlock: snapshot.blockNumber,
      snapshotObservedAt: snapshot.observedAt,
      sourceTreeSha256,
      sourceFiles,
      assets,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prerendered ${locales.length + 1} static entrypoints. Release manifest: ${Object.keys(assets).length} assets.`,
);
