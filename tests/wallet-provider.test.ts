import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { connect, disconnect } from "wagmi/actions";
import { base, mainnet } from "wagmi/chains";
import type { EIP1193Provider } from "viem";
import { createWalletSession, walletError } from "../src/wallet.ts";

const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: new EventTarget(),
});
after(() =>
  descriptor
    ? Object.defineProperty(globalThis, "window", descriptor)
    : Reflect.deleteProperty(globalThis, "window"),
);
const who = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
function provider() {
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  const requests: string[] = [];
  return {
    requests,
    account: who,
    chain: "0x2105",
    async response(
      method: string,
      params?: readonly { chainId: string }[],
    ): Promise<unknown> {
      if (
        method === "wallet_switchEthereumChain" ||
        method === "wallet_addEthereumChain"
      ) {
        this.chain = params![0].chainId;
        this.emit("chainChanged", this.chain);
        return null;
      }
      if (method === "eth_chainId") return this.chain;
      if (method === "eth_accounts" || method === "eth_requestAccounts")
        return [this.account];
      throw Object.assign(new Error("Unsupported method"), { code: -32601 });
    },
    async request({
      method,
      params,
    }: {
      method: string;
      params?: readonly { chainId: string }[];
    }) {
      requests.push(method);
      return this.response(method, params);
    },
    on(name: string, fn: (...args: unknown[]) => void) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name)!.add(fn);
    },
    removeListener(name: string, fn: (...args: unknown[]) => void) {
      events.get(name)?.delete(fn);
    },
    emit(name: string, ...args: unknown[]) {
      events.get(name)?.forEach((fn) => fn(...args));
    },
  };
}
function fixture(legacy = false) {
  const a = provider(),
    b = provider();
  const config = createConfig({
    chains: [base, mainnet],
    connectors: legacy
      ? [injected({ shimDisconnect: false })]
      : [a, b].map((p, i) =>
          injected({
            target: {
              id: `fixture-${i}`,
              name: `Fixture ${i}`,
              provider: p as unknown as EIP1193Provider,
            },
            shimDisconnect: false,
          }),
        ),
    multiInjectedProviderDiscovery: false,
    storage: null,
    ssr: true,
    transports: {
      [base.id]: http("https://base.invalid"),
      [mainnet.id]: http("https://ethereum.invalid"),
    },
  });
  return { a, b, config, session: createWalletSession(config) };
}

test("wagmi setup and the review adapter never request authorization", async () => {
  const { a, b, session } = fixture();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...a.requests, ...b.requests], []);
  assert.equal(session.current().account, null);
  await assert.rejects(
    session.assertWallet(who, session.current().revision),
    /walletChanged/,
  );
  session.stop();
});
test("a real wagmi connector owns connection, chain switching and disconnect", async () => {
  const { a, config, session } = fixture();
  await connect(config, { connector: config.connectors[0] });
  const revision = session.current().revision;
  assert.equal(await session.assertWallet(who, revision), a);
  assert.deepEqual(
    a.requests.filter((m) => m === "eth_requestAccounts"),
    ["eth_requestAccounts"],
  );
  await session.switchChain(1, ["https://ethereum.invalid"]);
  assert.equal(session.current().chainId, 1);
  await assert.rejects(session.assertWallet(who, revision), /walletChanged/);
  await disconnect(config);
  assert.equal(session.current().account, null);
  assert.equal(
    a.requests.some((m) => /sendTransaction|sign/.test(m)),
    false,
  );
  session.stop();
});
test("account round trips invalidate reviews even when the original address returns", async () => {
  const { a, config, session } = fixture();
  await connect(config, { connector: config.connectors[0] });
  const revision = session.current().revision;
  a.account = other;
  a.emit("accountsChanged", [other]);
  a.account = who;
  a.emit("accountsChanged", [who]);
  assert.ok(session.current().revision > revision);
  await assert.rejects(session.assertWallet(who, revision), /walletChanged/);
  session.stop();
});
test("same-address provider replacement invalidates a previously reviewed operation", async () => {
  const { a, b, config, session } = fixture();
  await connect(config, { connector: config.connectors[0] });
  const revision = session.current().revision;
  await connect(config, { connector: config.connectors[1] });
  a.emit("chainChanged", "0x1");
  assert.equal(session.current().chainId, 8453);
  await assert.rejects(session.assertWallet(who, revision), /walletChanged/);
  assert.equal(await session.assertWallet(who, session.current().revision), b);
  session.stop();
});
test("provider account and chain reads cannot silently disagree with the reviewed identity", async () => {
  const { a, config, session } = fixture();
  await connect(config, { connector: config.connectors[0] });
  const revision = session.current().revision;
  a.account = other;
  await assert.rejects(session.assertWallet(who, revision), /walletChanged/);
  a.account = who;
  a.chain = "0x1";
  await assert.rejects(session.assertWallet(who, revision), /walletChanged/);
  session.stop();
});
test("legacy injected replacement with the same address and chain requires reconnect", async () => {
  const ethereum = Object.getOwnPropertyDescriptor(window, "ethereum");
  const { a, b, config, session } = fixture(true);
  try {
    Object.defineProperty(window, "ethereum", { configurable: true, value: a });
    await connect(config, { connector: config.connectors[0] });
    const revision = session.current().revision;
    assert.equal(await session.assertWallet(who, revision), a);
    Object.defineProperty(window, "ethereum", { configurable: true, value: b });
    await assert.rejects(session.assertWallet(who, revision), /walletChanged/);
    assert.equal(b.requests.includes("eth_sendTransaction"), false);
    await disconnect(config);
    await connect(config, { connector: config.connectors[0] });
    assert.equal(
      await session.assertWallet(who, session.current().revision),
      b,
    );
    await disconnect(config);
  } finally {
    session.stop();
    ethereum
      ? Object.defineProperty(window, "ethereum", ethereum)
      : Reflect.deleteProperty(window, "ethereum");
  }
});
test("a disconnect during asynchronous identity validation prevents a wallet handoff", async () => {
  const { a, config, session } = fixture();
  await connect(config, { connector: config.connectors[0] });
  const response = a.response.bind(a);
  let release!: (value: unknown) => void;
  a.response = async (method, params) =>
    method === "eth_accounts"
      ? new Promise((r) => {
          release = r;
        })
      : response(method, params);
  const pending = session.assertWallet(who, session.current().revision);
  while (!release) await new Promise((r) => setImmediate(r));
  await disconnect(config);
  release([who]);
  await assert.rejects(pending, /walletChanged/);
  assert.equal(a.requests.includes("eth_sendTransaction"), false);
  session.stop();
});
test("a stale switch cannot redirect its follow-up to the newly selected wallet", async () => {
  const { a, b, config, session } = fixture();
  await connect(config, { connector: config.connectors[0] });
  const response = a.response.bind(a);
  let reject!: (error: unknown) => void;
  a.response = async (method, params) =>
    method === "wallet_switchEthereumChain"
      ? new Promise((_, r) => {
          reject = r;
        })
      : response(method, params);
  const pending = session.switchChain(1, ["https://ethereum.invalid"]);
  while (!reject) await new Promise((r) => setImmediate(r));
  await connect(config, { connector: config.connectors[1] });
  reject({ code: 4902 });
  await assert.rejects(pending, /walletChanged/);
  assert.equal(b.requests.includes("wallet_addEthereumChain"), false);
  session.stop();
});
test("wrapped wallet rejection and already-pending errors preserve recovery semantics", () => {
  assert.equal(walletError({ cause: { code: 4001 } }), "rejected");
  assert.equal(walletError({ name: "UserRejectedRequestError" }), "rejected");
  assert.equal(walletError({ cause: { code: -32002 } }), "walletPending");
  assert.equal(
    walletError(new Error("arbitrary untrusted text")),
    "walletFailed",
  );
});
