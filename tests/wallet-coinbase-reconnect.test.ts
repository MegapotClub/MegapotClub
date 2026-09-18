import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Exercise the pinned Coinbase SDK, WalletLink signer, RainbowKit connector and
// production startup together. Only external relay transport/UI is substituted.
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve("@wagmi/connectors"));
const sdkEntry = pathToFileURL(sdkRequire.resolve("@coinbase/wallet-sdk"));
const address = "0x1111111111111111111111111111111111111111";
const records = new Map<string, string>();
const tabs = new Map<string, string>();
const storage = (map: Map<string, string>) => ({
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => map.set(key, String(value)),
  removeItem: (key: string) => map.delete(key),
  key: (index: number) => [...map.keys()][index] ?? null,
  get length() {
    return map.size;
  },
});
Object.defineProperty(globalThis, "localStorage", {
  value: storage(records),
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: storage(tabs),
  configurable: true,
});
const browser = new EventTarget();
Object.defineProperty(browser, "location", {
  value: new URL("https://club.example/"),
});
Object.defineProperty(globalThis, "window", {
  value: browser,
  configurable: true,
});
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () =>
    new Response("", {
      headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" },
    }),
});

let approvals = 0;
let delayed = false;
let deliveryDelay = 100;
let deliverAccounts: (accounts: string[]) => void = () => {};
let delivered = false;
const timers: ReturnType<typeof setTimeout>[] = [];
mock.module(
  new URL("./sign/walletlink/relay/WalletLinkRelay.js", sdkEntry).href,
  {
    namedExports: {
      WalletLinkRelay: class {
      constructor(options: { accountsCallback(accounts: string[]): void }) {
        deliverAccounts = options.accountsCallback;
          if (delayed)
            timers.push(
              setTimeout(() => {
                delivered = true;
                options.accountsCallback([address]);
            }, deliveryDelay),
            );
        }
        async requestEthereumAccounts() {
          approvals++;
          throw new Error("Unexpected fresh mobile authorization");
        }
        getWalletLinkSession() {
          return { id: "fixture", secret: "fixture" };
        }
        resetAndReload() {}
      },
    },
  },
);

const {
  createWalletConfig,
  restoreWalletConfig,
  requestWalletReset,
  walletConfig,
} = await import("../src/walletConfig.ts");
const { connect, disconnect, getAccount } = await import("wagmi/actions");
const { createWalletSession } = await import("../src/wallet.ts");
const configs = [walletConfig];
function page() {
  const config = createWalletConfig();
  configs.push(config);
  return config;
}
function coinbase(config: ReturnType<typeof page>) {
  const connector = config.connectors.find((c) => c.id === "coinbaseWalletSDK");
  assert.ok(connector);
  return connector;
}
beforeEach(() => {
  records.clear();
  tabs.clear();
  approvals = 0;
  delayed = false;
  delivered = false;
  deliveryDelay = 100;
});
afterEach(() => {
  configs.splice(0).forEach((config) => config._internal.mipd?.destroy());
  timers.splice(0).forEach(clearTimeout);
});
async function connected() {
  records.set("-CBWSDK:SignerConfigurator:SignerType", "walletlink");
  records.set("-walletlink:https://www.walletlink.org:DefaultChainId", "8453");
  records.set("-walletlink:https://www.walletlink.org:Addresses", address);
  const config = page();
  await restoreWalletConfig(config);
  await connect(config, { connector: coinbase(config) });
  assert.equal(getAccount(config).address, address);
  return config;
}
async function observe(config: ReturnType<typeof page>) {
  const provider = (await coinbase(config).getProvider()) as {
    request(args: { method: string }): Promise<unknown>;
  };
  const requests: string[] = [];
  const request = provider.request.bind(provider);
  provider.request = ((args: { method: string }) => {
    requests.push(args.method);
    return request(args as never);
  }) as typeof provider.request;
  return requests;
}
function noWrites(requests: string[]) {
  assert.ok(
    requests.every((method) =>
      ["eth_accounts", "eth_requestAccounts", "eth_chainId"].includes(method),
    ),
    `only cached-session methods: ${requests.join(", ")}`,
  );
  assert.equal(approvals, 0, "no fresh authorization reaches the mobile relay");
}

test("real Coinbase SDK restores the selected mobile session across repeated reloads", async () => {
  await connected();
  for (let n = 0; n < 3; n++) {
    const config = page();
    const requests = await observe(config);
    const session = createWalletSession(config);
    assert.equal(
      session.current().account,
      null,
      "saved address is not live identity",
    );
    await restoreWalletConfig(config);
    assert.equal(getAccount(config).connector?.id, "coinbaseWalletSDK");
    assert.equal(session.current().account, address);
    await session.assertWallet(address, session.current().revision);
    noWrites(requests);
    session.stop();
  }
});

test("an interrupted page startup preserves the selected Coinbase session for the next page", async () => {
  await connected();
  page(); // Module initialized, but navigation/reload happens before React mounts.
  const next = page();
  await restoreWalletConfig(next);
  assert.equal(getAccount(next).address, address);
  assert.equal(approvals, 0);
});

test("Coinbase account delivery after the first passive check completes automatic restoration", async () => {
  await connected();
  records.delete("-walletlink:https://www.walletlink.org:Addresses");
  delayed = true;
  const config = page();
  const requests = await observe(config);
  await restoreWalletConfig(config);
  assert.equal(delivered, true);
  assert.equal(getAccount(config).address, address);
  noWrites(requests);
});

test("a two-second Coinbase relay response restores without manual intervention", async () => {
  await connected();
  records.delete("-walletlink:https://www.walletlink.org:Addresses");
  delayed = true;
  deliveryDelay = 2000;
  const config = page();
  await restoreWalletConfig(config);
  assert.equal(getAccount(config).address, address);
  assert.equal(approvals, 0);
});

test("Coinbase authorization disappearing during reconnect cannot open mobile approval", async () => {
  await connected();
  const config = page();
  const provider = await coinbase(config).getProvider() as { request(args: { method: string }): Promise<unknown> };
  const original = provider.request.bind(provider);
  let passiveReads = 0;
  provider.request = async (args) => {
    if (args.method === "eth_accounts" && ++passiveReads === 3) deliverAccounts([]);
    return original(args);
  };
  await restoreWalletConfig(config);
  assert.equal(getAccount(config).status, "disconnected");
  assert.equal(approvals, 0);
});

test("a timed-out Coinbase relay retains selection for the next page", async (t) => {
  await connected();
  const previous = records.get("megapot-club:wallet.store");
  records.delete("-walletlink:https://www.walletlink.org:Addresses");
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => timeout(fn, ms === 12_000 ? 80 : ms, ...args)) as typeof setTimeout);
  await restoreWalletConfig(page());
  assert.equal(records.get("megapot-club:wallet.store"), previous);
  records.set("-walletlink:https://www.walletlink.org:Addresses", address);
  const next = page();
  await restoreWalletConfig(next);
  assert.equal(getAccount(next).address, address);
  assert.equal(approvals, 0);
});

test("an interrupted reset is still honored by the next document", async () => {
  await connected();
  requestWalletReset();
  page();
  const next = page();
  await restoreWalletConfig(next);
  assert.equal(getAccount(next).status, "disconnected");
  assert.equal(approvals, 0);
});

test("explicit Coinbase disconnect stays disconnected on reload", async () => {
  const first = await connected();
  await disconnect(first);
  assert.equal(records.has("-CBWSDK:SignerConfigurator:SignerType"), false);
  const config = page();
  await restoreWalletConfig(config);
  assert.equal(getAccount(config).status, "disconnected");
  assert.equal(approvals, 0);
});

test("reset remains disconnected on subsequent reloads even when Coinbase retains its cache", async () => {
  await connected();
  requestWalletReset();
  await restoreWalletConfig(page());
  assert.equal(records.has("-CBWSDK:SignerConfigurator:SignerType"), true);
  const next = page();
  await restoreWalletConfig(next);
  assert.equal(getAccount(next).status, "disconnected");
  assert.equal(approvals, 0);
});
