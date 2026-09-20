import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** Exercise the browser's manifest loader against a synthetic cookie boundary. */
export function manifestAuth(): Plugin {
  return {
    name: "manifest-auth-fixture",
    apply: "serve",
    configureServer(server) {
      const observations: {
        mode: string;
        authorized: boolean;
        status: number;
      }[] = [];
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://fixture.invalid");
        if (!url.pathname.startsWith("/tests/browser/manifest-auth/"))
          return next();
        response.setHeader("Cache-Control", "no-store");
        if (url.pathname.endsWith("audit")) {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(observations));
        } else if (url.pathname.endsWith("manifest.webmanifest")) {
          const authorized = (request.headers.cookie ?? "")
            .split("; ")
            .includes("club-manifest-fixture=authorized");
          observations.push({
            mode: url.searchParams.get("mode") ?? "fixed",
            authorized,
            status: authorized ? 200 : 401,
          });
          response.writeHead(authorized ? 200 : 401, {
            "Content-Type": "application/manifest+json",
          });
          response.end(
            authorized
              ? readFileSync(
                  resolve(server.config.root, "dist/manifest.webmanifest"),
                )
              : "Unauthorized",
          );
        } else if (url.pathname.endsWith("audit.js")) {
          response.setHeader("Content-Type", "text/javascript");
          response.end(
            `setInterval(async () => { document.querySelector('output').textContent = JSON.stringify(await (await fetch('./audit')).json()); }, 500);`,
          );
        } else {
          const html = readFileSync(
            resolve(server.config.root, "dist/index.html"),
            "utf8",
          );
          const link = html.match(/<link rel="manifest"[^>]+>/)?.[0];
          if (!link) {
            response.writeHead(500).end("Production manifest link missing");
            return;
          }
          const control = url.searchParams.has("control");
          const manifest = link.replace(
            /href="[^"]+"/,
            `href="./manifest.webmanifest?mode=${control ? "control" : "fixed"}"`,
          );
          response.setHeader(
            "Set-Cookie",
            "club-manifest-fixture=authorized; Path=/tests/browser/manifest-auth/; HttpOnly; SameSite=Lax",
          );
          response.setHeader("Content-Type", "text/html");
          response.end(
            `<!doctype html><html><head><title>Manifest credentials verification</title>${control ? manifest.replace(' crossorigin="use-credentials"', "") : manifest}</head><body><h1>Manifest credentials verification</h1><p>${control ? "Old link without credentials" : "Production link with credentials"}</p><a href="./?control">Check old behavior</a> · <a href="./">Check fixed behavior</a><pre><output>Waiting for browser manifest request</output></pre><script src="./audit.js"></script></body></html>`,
          );
        }
      });
    },
  };
}
