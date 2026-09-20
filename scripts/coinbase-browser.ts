import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "rolldown";

// Narrow adaptation for the pinned WalletLink mobile UI. Refuse an SDK upgrade
// until the new implementation and the real relay boundary have been reviewed.
export function coinbaseBrowser(): Plugin {
  const root = resolve(
    "node_modules/@wagmi/connectors/node_modules/@coinbase/wallet-sdk",
  );
  const relay = `${root}/dist/sign/walletlink/relay/WalletLinkRelay.js`;
  const util = `${root}/dist/sign/walletlink/relay/ui/components/util.js`;
  const expected = new Map([
    [util, "5358e7e35e310c691c7853d07e451c7076afb434f61f9fe9218b2994f54a8d22"],
    [relay, "3e50cd87aac53756995fac151f2781cf83b93aff5363628908a3b8539113082b"],
  ]);
  const digest = (s: string) => createHash("sha256").update(s).digest("hex");
  if (
    JSON.parse(readFileSync(`${root}/package.json`, "utf8")).version !== "4.3.6"
  )
    throw new Error(
      "Review the Coinbase mobile handoff adaptation before upgrading the SDK",
    );
  for (const [file, hash] of expected)
    if (digest(readFileSync(file, "utf8")) !== hash)
      throw new Error(
        "Coinbase mobile handoff source changed; review required",
      );
  return {
    name: "coinbase-mobile-handoff",
    transform(code, id) {
      const file = id.split("?")[0];
      if (!expected.has(file)) return;
      if (digest(code) !== expected.get(file))
        throw new Error("Coinbase mobile handoff transform input changed");
      if (file === util) {
        const replacement = `import { isCoinbaseMobileBrowser } from ${JSON.stringify(resolve("src/coinbaseMobile.ts"))};\n`;
        return (
          replacement +
          code.replace(
            /export function isMobileWeb\(\) \{[\s\S]*?\n\}/,
            "export function isMobileWeb() { return isCoinbaseMobileBrowser(); }",
          )
        );
      }
      // A relay created during device emulation can outlive that emulation.
      return code.replace(
        "if (this.isMobileWeb) {",
        "if (this.isMobileWeb && isMobileWeb()) {",
      );
    },
  };
}
