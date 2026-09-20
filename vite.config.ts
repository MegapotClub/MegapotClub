import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { manifestAuth } from "./tests/browser/manifestAuth.ts";
import { exportPreview } from "./tests/browser/exportPreview.ts";
import { coinbaseBrowser } from "./scripts/coinbase-browser.ts";

export default defineConfig(({ mode }) => {
  const previewHost = loadEnv(mode, process.cwd(), "DEV_").DEV_ALLOWED_HOST;
  // Coinbase's WalletLink encoder uses Buffer for transaction calldata. Import
  // its browser implementation at unbound references, including SDK CJS modules.
  // Keep development and production identical; do not install a global shim.
  const transform = {
    inject: { Buffer: ["buffer/", "Buffer"] as [string, string] },
  };
  return {
    base: "./",
    resolve: {
      alias: {
        "club-test/coinbase-signer": resolve(
          "node_modules/@wagmi/connectors/node_modules/@coinbase/wallet-sdk/dist/sign/walletlink/WalletLinkSigner.js",
        ),
      },
    },
    plugins: [
      react(),
      exportPreview(),
      manifestAuth(),
      {
        name: "bundle-inventory",
        apply: "build",
        generateBundle(options, bundle) {
          if (options.dir?.includes("ssr")) return;
          mkdirSync(".build", { recursive: true });
          writeFileSync(
            ".build/bundle-modules.json",
            JSON.stringify(
              Object.fromEntries(
                Object.entries(bundle).flatMap(([name, item]) =>
                  item.type === "chunk"
                    ? [
                        [
                          name,
                          Object.keys(item.modules).map((path) =>
                            path.replace(`${process.cwd()}/`, ""),
                          ),
                        ],
                      ]
                    : [],
                ),
              ),
              null,
              2,
            ),
          );
        },
      },
    ],
    server: {
      host: "0.0.0.0",
      port: 4173,
      strictPort: true,
      allowedHosts: ["terminal.local", ...(previewHost ? [previewHost] : [])],
    },
    optimizeDeps: {
      // The browser fixture imports the exact installed SDK encoder directly.
      // Include its CJS dependencies in the same optimizer used by the connector.
      include: ["club-test/coinbase-signer"],
      rolldownOptions: { transform, plugins: [coinbaseBrowser()] },
    },
    build: {
      target: "es2022",
      sourcemap: false,
      cssCodeSplit: true,
      rolldownOptions: { transform, plugins: [coinbaseBrowser()] },
    },
  };
});
