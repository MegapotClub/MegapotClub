import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { rolldown, type InputOptions } from "rolldown";
import { loadConfigFromFile } from "vite";
import { isCoinbaseMobileBrowser } from "../src/coinbaseMobile.ts";

const desktop = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  platform: "MacIntel",
  maxTouchPoints: 0,
};
const phone = {
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9 XL)",
  platform: "Linux armv8l",
  maxTouchPoints: 5,
};
const ipad = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  platform: "MacIntel",
  maxTouchPoints: 5,
};

test("Coinbase mobile hints distinguish desktop emulation and preserve phones and iPadOS", () => {
  assert.equal(isCoinbaseMobileBrowser(), false);
  for (const device of [
    desktop,
    { ...phone, platform: "MacIntel" },
    { ...phone, platform: "Win32" },
    { ...phone, platform: "Linux x86_64" },
    { ...phone, maxTouchPoints: 0 },
  ])
    assert.equal(isCoinbaseMobileBrowser(device), false);
  for (const device of [
    phone,
    ipad,
    { userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5 },
  ])
    assert.equal(isCoinbaseMobileBrowser(device), true);
});

async function bundle(plugins: InputOptions["plugins"]) {
  const build = await rolldown({
    input: "tests/fixtures/coinbaseRelayBoundary.ts",
    platform: "browser",
    tsconfig: false,
    plugins,
    transform: { inject: { Buffer: ["buffer/", "Buffer"] } },
  });
  const { output } = await build.generate({
    format: "iife",
    name: "RelayBoundary",
    codeSplitting: false,
  });
  await build.close();
  return output.find((x) => x.type === "chunk")!.code;
}
function exercise(code: string, device: typeof desktop, method: string) {
  const opened: { href: string; target: string; rel: string }[] = [];
  const realm: Record<string, unknown> = {
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: device,
    addEventListener() {},
    removeEventListener() {},
    location: { href: "https://megapotclub.eth.limo/#winnings" },
    document: {
      createElement(tag: string) {
        assert.equal(tag, "a");
        return {
          href: "",
          target: "",
          rel: "",
          click() {
            opened.push({
              href: this.href,
              target: this.target,
              rel: this.rel,
            });
          },
        };
      },
    },
    fetch() {
      throw new Error("Unexpected relay fixture network request");
    },
  };
  realm.window = realm;
  runInNewContext(code + ";globalThis.boundary=RelayBoundary;", realm);
  const request = {
    method,
    params: {
      chainId: "0x2105",
      data: "0x095ea7b3",
      from: "0x1111111111111111111111111111111111111111",
    },
  };
  const sent = (
    realm.boundary as {
      publishFixture: (mobile: boolean, r: typeof request) => unknown[];
    }
  ).publishFixture(true, request);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [
    {
      event: "Web3Request",
      message: { type: "WEB3_REQUEST", id: "fixture-id", request },
      encrypted: true,
    },
  ]);
  return opened;
}
test("configured Coinbase build and optimizer retain relay messages without desktop tabs", async () => {
  const config = await loadConfigFromFile({
    command: "build",
    mode: "production",
  });
  assert.ok(config);
  const control = await bundle([]);
  assert.equal(exercise(control, desktop, "signEthereumTransaction").length, 1);
  for (const plugins of [
    config.config.build?.rolldownOptions?.plugins,
    config.config.optimizeDeps?.rolldownOptions?.plugins,
  ]) {
    const code = await bundle(plugins);
    for (const method of [
      "signEthereumTransaction",
      "requestEthereumAccounts",
      "switchEthereumChain",
    ]) {
      assert.equal(exercise(code, desktop, method).length, 0);
      assert.equal(
        exercise(code, { ...phone, platform: "MacIntel" }, method).length,
        0,
      );
      for (const device of [phone, ipad]) {
        const opened = exercise(code, device, method);
        if (method !== "signEthereumTransaction") {
          assert.equal(opened.length, 0);
          continue;
        }
        assert.equal(opened.length, 1);
        const url = new URL(opened[0].href);
        assert.equal(
          url.origin + url.pathname,
          "https://go.cb-w.com/walletlink",
        );
        assert.equal(
          url.searchParams.get("redirect_url"),
          "https://megapotclub.eth.limo/#winnings",
        );
        assert.equal(opened[0].target, "cbw-opener");
        assert.equal(opened[0].rel, "noreferrer noopener");
      }
    }
  }
});
