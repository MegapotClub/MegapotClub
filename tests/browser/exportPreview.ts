import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/** Serve the exported bytes without development HTML transforms, including its CSP. */
export function exportPreview(): Plugin {
  return {
    name: "export-preview",
    apply: "serve",
    configureServer(server) {
      const root = resolve(server.config.root, "dist");
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2",
        ".xml": "application/xml",
        ".txt": "text/plain",
      };
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/dist/")) return next();
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405).end();
          return;
        }
        try {
          const name = decodeURIComponent(request.url.split("?")[0].slice(6));
          let file = resolve(root, name || "index.html");
          if (file !== root && !file.startsWith(root + sep)) {
            response.writeHead(403).end();
            return;
          }
          if (existsSync(file) && statSync(file).isDirectory())
            file = resolve(file, "index.html");
          if (!existsSync(file) || !statSync(file).isFile()) {
            response.writeHead(404).end();
            return;
          }
          response.writeHead(200, {
            "Content-Type": types[extname(file)] || "application/octet-stream",
            "Cache-Control": "no-store",
          });
          if (request.method === "HEAD") response.end();
          else if (
            extname(file) === ".html" &&
            request.url.includes("traffic=1")
          )
            response.end(
              readFileSync(file, "utf8").replace(
                "<head>",
                '<head><script src="/tests/browser/traffic.js"></script>',
              ),
            );
          else
            createReadStream(file)
              .on("error", () => response.destroy())
              .pipe(response);
        } catch {
          response.writeHead(400).end();
        }
      });
    },
  };
}
