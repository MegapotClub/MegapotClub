import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";

export default defineConfig(({ mode }) => {
  const previewHost = loadEnv(mode, process.cwd(), "DEV_").DEV_ALLOWED_HOST;
  return {
    base: "./",
    plugins: [
      react(),
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
      allowedHosts: previewHost ? [previewHost] : [],
    },
    build: { target: "es2022", sourcemap: false, cssCodeSplit: true },
  };
});
