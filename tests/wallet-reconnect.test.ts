import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { connect, disconnect, getAccount } from "wagmi/actions";
import {
  createWalletConfig as createProductionConfig,
  restoreWalletConfig,
  requestWalletReset,
} from "../src/walletConfig.ts";
import { createWalletSession } from "../src/wallet.ts";

const address = "0x1111111111111111111111111111111111111111";
const secondAddress = "0x2222222222222222222222222222222222222222";
const values = new Map<string, string>();
const original = ["window", "localStorage", "sessionStorage", "fetch"].map(
  (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
);
const configs: ReturnType<typeof createProductionConfig>[] = [];
const cleanups: (() => void)[] = [];
function createWalletConfig() {
  const config = createProductionConfig();
  configs.push(config);
  return config;
}
afterEach(() => {
  configs.splice(0).forEach((config) => config._internal.mipd?.destroy());
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
// The Coinbase connector checks page headers during setup; this suite has no network.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  value: async () =>
    new Response("", {
      headers: { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" },
    }),
});
const browser = new EventTarget();
Object.defineProperty(browser, "location", {
  value: new URL("https://club.example"),
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: browser,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: localStorage,
});
after(() => {
  for (const [key, descriptor] of original)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
});
beforeEach(() => values.clear());

function provider() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const wallet = {
    authorized: false,
    address,
    chain: "0x2105",
    requests: [] as string[],
    async request({ method }: { method: string }): Promise<unknown> {
      this.requests.push(method);
      if (method === "eth_accounts")
        return this.authorized ? [this.address] : [];
      if (method === "eth_chainId") return this.chain;
      if (method === "eth_requestAccounts") {
        this.authorized = true;
        return [this.address];
      }
      throw Object.assign(new Error("Unsupported fixture method"), {
        code: -32601,
      });
    },
    on(name: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    removeListener(name: string, listener: (...args: unknown[]) => void) {
      listeners.get(name)?.delete(listener);
    },
  };
  Object.defineProperty(browser, "ethereum", {
    configurable: true,
    value: wallet,
  });
  return wallet;
}

async function mount(config: ReturnType<typeof createWalletConfig>) {
  // Exercise the same upstream hydration lifecycle used by WagmiProvider,
  // including the production storage namespace and injected connector.
  await restoreWalletConfig(config);
  const deadline = Date.now() + 3_000;
  while (["connecting", "reconnecting"].includes(config.state.status)) {
    assert.ok(Date.now() < deadline, "reconnection settles");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function connected(wallet: ReturnType<typeof provider>) {
  const config = createWalletConfig();
  await mount(config);
  const connector = config.connectors.find((c) => c.id === "injected");
  assert.ok(connector);
  await connect(config, { connector });
  assert.equal(getAccount(config).address, wallet.address);
  wallet.requests.length = 0;
  return config;
}
const readOnly = (requests: string[]) =>
  assert.ok(
    requests.every((method) =>
      ["eth_accounts", "eth_chainId"].includes(method),
    ),
    `restoration requested only passive reads: ${requests.join(", ")}`,
  );

test("a fresh visit does not request wallet authorization", async () => {
  const wallet = provider();
  const config = createWalletConfig();
  await mount(config);
  assert.equal(getAccount(config).status, "disconnected");
  readOnly(wallet.requests);
});

test("a fresh app instance restores the previously connected wallet from production storage", async () => {
  const wallet = provider();
  await connected(wallet);
  assert.ok(values.has("megapot-club:wallet.store"));
  const reloaded = createWalletConfig();
  const session = createWalletSession(reloaded);
  assert.equal(session.current().account, null);
  await mount(reloaded);
  assert.equal(session.current().account, address);
  assert.equal(
    await session.assertWallet(address, session.current().revision),
    wallet,
  );
  readOnly(wallet.requests);
  session.stop();
});

test("reload uses the live account and chain instead of the persisted identity", async () => {
  const wallet = provider();
  await connected(wallet);
  wallet.address = secondAddress;
  wallet.chain = "0x1";
  const reloaded = createWalletConfig();
  const session = createWalletSession(reloaded);
  await mount(reloaded);
  assert.equal(session.current().account, secondAddress);
  assert.equal(session.current().chainId, 1);
  await assert.rejects(
    session.assertWallet(address, session.current().revision),
    /walletChanged/,
  );
  readOnly(wallet.requests);
  session.stop();
});

test("an explicit disconnect remains disconnected after a fresh app instance", async () => {
  const wallet = provider();
  const first = await connected(wallet);
  await disconnect(first);
  wallet.requests.length = 0;
  assert.equal(
    wallet.authorized,
    true,
    "fixture cannot revoke; wagmi must honor its disconnect marker",
  );
  const reloaded = createWalletConfig();
  await mount(reloaded);
  assert.equal(getAccount(reloaded).status, "disconnected");
  readOnly(wallet.requests);
});

test("a revoked wallet never becomes connected merely because an address was persisted", async () => {
  const wallet = provider();
  await connected(wallet);
  wallet.authorized = false;
  const reloaded = createWalletConfig();
  const session = createWalletSession(reloaded);
  await mount(reloaded);
  assert.equal(session.current().account, null);
  await assert.rejects(
    session.assertWallet(address, session.current().revision),
    /walletChanged/,
  );
  readOnly(wallet.requests);
  session.stop();
});

test("a removed extension leaves the app disconnected without losing its public interface", async () => {
  const wallet = provider();
  await connected(wallet);
  Reflect.deleteProperty(browser, "ethereum");
  const reloaded = createWalletConfig();
  await mount(reloaded);
  assert.equal(getAccount(reloaded).status, "disconnected");
  assert.equal(wallet.requests.length, 0);
});

test("malformed saved JSON does not prevent a fresh visit", async () => {
  provider();
  values.set("megapot-club:wallet.store", "{broken");
  const config = createWalletConfig();
  await mount(config);
  assert.equal(getAccount(config).status, "disconnected");
});

function announce(wallet: ReturnType<typeof provider>, id: string) {
  const detail = {
    info: {
      uuid: id,
      name: id,
      rdns: id,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    },
    provider: wallet,
  };
  const send = () =>
    browser.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail }),
    );
  browser.addEventListener("eip6963:requestProvider", send);
  cleanups.push(() =>
    browser.removeEventListener("eip6963:requestProvider", send),
  );
  return send;
}

test("disconnect through a discovered connector cannot reconnect through its generic alias", async () => {
  const wallet = provider();
  announce(wallet, "org.club.fixture");
  const first = createWalletConfig();
  await mount(first);
  const connector = first.connectors.find(
    (item) => item.id === "org.club.fixture",
  )!;
  assert.ok(connector);
  await connect(first, { connector });
  await disconnect(first);
  assert.equal(wallet.authorized, true);
  wallet.requests.length = 0;
  const reloaded = createWalletConfig();
  await mount(reloaded);
  assert.equal(getAccount(reloaded).status, "disconnected");
  assert.deepEqual(wallet.requests, []);
});

test("restore selects the previous connector and never another authorized wallet", async () => {
  const firstWallet = provider();
  const selected = provider();
  firstWallet.authorized = true;
  announce(firstWallet, "org.club.first");
  announce(selected, "org.club.selected");
  const first = createWalletConfig();
  await mount(first);
  await connect(first, {
    connector: first.connectors.find(
      (item) => item.id === "org.club.selected",
    )!,
  });
  firstWallet.requests.length = selected.requests.length = 0;
  const reloaded = createWalletConfig();
  await mount(reloaded);
  assert.equal(getAccount(reloaded).connector?.id, "org.club.selected");
  assert.deepEqual(firstWallet.requests, []);
  readOnly(selected.requests);
});

test("revoked selected wallet does not fall back to a different authorized wallet", async () => {
  const fallback = provider();
  const selected = provider();
  fallback.authorized = true;
  announce(fallback, "org.club.fallback");
  announce(selected, "org.club.revoked");
  const first = createWalletConfig();
  await mount(first);
  await connect(first, {
    connector: first.connectors.find((item) => item.id === "org.club.revoked")!,
  });
  selected.authorized = false;
  fallback.requests.length = selected.requests.length = 0;
  const reloaded = createWalletConfig();
  await mount(reloaded);
  assert.equal(getAccount(reloaded).status, "disconnected");
  assert.deepEqual(fallback.requests, []);
  readOnly(selected.requests);
});

test("repeated initialization shares one restoration without duplicate wallet requests", async () => {
  const wallet = provider();
  await connected(wallet);
  const reloaded = createWalletConfig();
  const one = restoreWalletConfig(reloaded);
  assert.equal(restoreWalletConfig(reloaded), one);
  await one;
  const count = wallet.requests.length;
  await restoreWalletConfig(reloaded);
  assert.equal(wallet.requests.length, count);
  assert.equal(getAccount(reloaded).address, address);
});

test("a one-use reset skips a stalled prior wallet on the next document", async () => {
  const wallet = provider();
  await connected(wallet);
  const originalRequest = wallet.request.bind(wallet);
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => {
    release = resolve;
  });
  wallet.request = async (args) => {
    if (args.method === "eth_accounts") await deferred;
    return originalRequest(args);
  };
  const stalled = createWalletConfig();
  const pending = restoreWalletConfig(stalled);
  const result = await Promise.race([
    pending.then(() => "settled"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 20)),
  ]);
  assert.equal(result, "pending");
  requestWalletReset();
  // A late old-document response writes its connected state before unloading.
  // Release it first so the library's global reconnect lock cannot mask failure.
  release();
  await pending;
  assert.equal(getAccount(stalled).status, "connected");
  wallet.requests.length = 0;
  const reset = createWalletConfig();
  await mount(reset);
  assert.equal(getAccount(reset).status, "disconnected");
  assert.equal(values.has("megapot-club:skip-wallet-restore"), false);
  assert.deepEqual(wallet.requests, []);
});
