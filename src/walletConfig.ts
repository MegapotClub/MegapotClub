import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, createStorage, fallback } from "wagmi";
import { rpcHttp } from "./rpcTransport.ts";
import { hydrate } from "@wagmi/core";
import { reconnect } from "wagmi/actions";
import type { Config, Connector, CreateConnectorFn } from "wagmi";
import { base, mainnet } from "wagmi/chains";
import { APP_NAME, DEFAULT_RPC_URLS } from "./config.ts";

const resetKey = "megapot-club:skip-wallet-restore";
export function requestWalletReset() {
  // A new document is required: wagmi's in-flight reconnect has no abort API.
  // This one-use intent survives a late old-document persistence write.
  sessionStorage.setItem(resetKey, "1");
}
function consumeWalletReset() {
  try {
    return sessionStorage.getItem(resetKey) === "1";
  } catch {
    return false;
  }
}

/**
 * @cc [label:security] coinbase-passive-reconnect
 * During automatic reconnect, Coinbase account requests MUST be passive reads.
 * Loss of authorization MUST NOT initiate phone pairing. Manual connection and
 * upstream connector event lifecycle remain owned by wagmi/Coinbase.
 */
function passiveCoinbase(factory: CreateConnectorFn): CreateConnectorFn {
  return (parameters) => {
    const connector = factory(parameters);
    if (connector.id !== "coinbaseWalletSDK") return connector;
    return {
      ...connector,
      connect: async function (
        this: ReturnType<CreateConnectorFn>,
        options: Parameters<typeof connector.connect>[0],
      ) {
        if (!options?.isReconnecting)
          return connector.connect.call(this, options);
        const provider = (await this.getProvider()) as {
          request(args: { method: string; params?: unknown }): Promise<unknown>;
        };
        const passiveProvider = new Proxy(provider, {
          get(target, property) {
            if (property === "request")
              return async (args: { method: string; params?: unknown }) => {
                if (args.method === "eth_requestAccounts") {
                  const accounts = await target.request({
                    method: "eth_accounts",
                  });
                  if (!Array.isArray(accounts) || !accounts.length)
                    throw new Error("walletUnauthorized");
                  return accounts;
                }
                if (
                  args.method !== "eth_chainId" &&
                  args.method !== "eth_accounts"
                )
                  throw new Error("walletUnauthorized");
                return target.request(args);
              };
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        // The original connector installs and removes its normal event listeners.
        // The facade exists only for this passive call; later signing retains the
        // original provider identity checked by the transaction boundary.
        return connector.connect.call(
          { ...this, getProvider: async () => passiveProvider },
          options,
        );
        // Return the upstream result unchanged, including withCapabilities shape.
      } as typeof connector.connect,
    };
  };
}

/**
 * @cc [label:architecture] keyless-wallet-library
 * Connection UI, discovery and session state belong to RainbowKit/wagmi. No
 * WalletConnect connector, shared project credential or hosted wallet catalog
 * may be configured. Coinbase pairing is an explicit, optional relay service.
 */
export function createWalletConfig() {
  // createConfig writes its initial empty store, even with ssr enabled. Delay
  // store writes until restoration settles so an interrupted mount loses nothing.
  let persistSession = false;
  coinbaseWallet.preference = { options: "eoaOnly", telemetry: false };
  const connectors = connectorsForWallets(
    [{ groupName: "Popular", wallets: [coinbaseWallet, injectedWallet] }],
    {
      appName: APP_NAME,
      // This required upstream option is unused by both selected connectors.
      // An empty value also makes accidental WalletConnect configuration fail.
      projectId: "",
    },
  );
  const storage = createStorage({
    key: "megapot-club:wallet",
    storage: {
      getItem(key) {
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem(key, value) {
        if (key === "megapot-club:wallet.store" && !persistSession) return;
        try {
          localStorage.setItem(key, value);
        } catch {
          /* Optional preference. */
        }
      },
      removeItem(key) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* Optional preference. */
        }
      },
    },
  });
  // Capture the library record before createConfig can initialize its store.
  const resetting = consumeWalletReset();
  const saved = resetting
    ? Promise.resolve(null)
    : Promise.resolve(storage.getItem("store")).catch(() => null);
  const config = createConfig({
    chains: [base, mainnet],
    batch: { multicall: { wait: 20, batchSize: 8192 } },
    connectors: connectors.map(passiveCoinbase),
    multiInjectedProviderDiscovery: true,
    ccipRead: false,
    ssr: true,
    storage,
    transports: {
      [base.id]: fallback(
        DEFAULT_RPC_URLS.map((url) => rpcHttp(url)),
        { retryCount: 0, rank: false },
      ),
      [mainnet.id]: rpcHttp("https://ethereum-rpc.publicnode.com"),
    },
  });
  startups.set(config, {
    saved,
    resetting,
    enablePersistence: () => {
      persistSession = true;
    },
  });
  return config;
}

type Startup = {
  saved: Promise<unknown>;
  resetting: boolean;
  enablePersistence(): void;
  running?: Promise<void>;
};
const startups = new WeakMap<Config, Startup>();

// Coinbase's relay may restore accounts asynchronously. Listen before checking
// so a quick response cannot be missed; never start a new pairing as a retry.
async function waitForCoinbaseAccounts(connector: Connector) {
  const provider = (await connector.getProvider()) as {
    on(event: "accountsChanged", listener: () => void): void;
    removeListener(event: "accountsChanged", listener: () => void): void;
  };
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      provider.removeListener("accountsChanged", onAccounts);
      resolve();
    };
    const onAccounts = () => {
      void connector
        .isAuthorized()
        .then((yes) => {
          if (yes) finish();
        })
        .catch(() => {});
    };
    // The UI exposes reset after 8s. A slow relay is not a revoked session.
    const timer = setTimeout(finish, 12_000);
    provider.on("accountsChanged", onAccounts);
    onAccounts();
  });
}

/**
 * @cc [label:security] restore-only-active-connector
 * A reload MUST restore only the active connector recorded by wagmi. An empty
 * saved session, missing connector or revoked permission MUST NOT fall back to
 * another authorized wallet or another alias of a disconnected provider.
 * Stored accounts are hints, never evidence of a live wallet identity.
 */
export function restoreWalletConfig(config: Config): Promise<void> {
  const startup = startups.get(config);
  if (!startup)
    return Promise.reject(new Error("Unknown wallet configuration"));
  let preserveSelection = false;
  return (startup.running ??= (async () => {
    const saved = await startup.saved;
    // Public wagmi hydration performs persistence and EIP-6963 setup. Disable
    // its broad scan; reconnect below supplies one exact library connector.
    await hydrate(config, { reconnectOnMount: false }).onMount();
    config.setState((state) => ({
      ...state,
      current: null,
      connections: new Map(),
      status: "disconnected",
    }));
    if (!saved || typeof saved !== "object" || !("state" in saved)) return;
    const state = saved.state;
    if (
      !state ||
      typeof state !== "object" ||
      !("current" in state) ||
      !("connections" in state) ||
      typeof state.current !== "string" ||
      !(state.connections instanceof Map)
    )
      return;
    preserveSelection = true;
    const connection = state.connections.get(state.current);
    const previous = connection?.connector;
    if (
      !previous ||
      typeof previous.id !== "string" ||
      typeof previous.type !== "string"
    )
      return;
    const connector = config.connectors.find(
      (item) => item.id === previous.id && item.type === previous.type,
    );
    // Passing [] would ask wagmi to scan every connector. Never do that.
    if (connector) {
      if (connector.id === "coinbaseWalletSDK")
        await waitForCoinbaseAccounts(connector);
      await reconnect(config, { connectors: [connector] });
    }
  })().finally(async () => {
    startup.enablePersistence();
    // A temporarily unavailable provider is not an explicit disconnect. Preserve
    // its selection for the next visit, including relay timeout or offline cases.
    if (!preserveSelection || config.state.status === "connected")
      config.setState((state) => ({ ...state }));
    if (startup.resetting) {
      // Do not consume reset until the empty library record is durable. A second
      // refresh before mount must still skip restoration of the old session.
      try {
        const record = await config.storage?.getItem("store");
        if (
          record &&
          typeof record === "object" &&
          "state" in record &&
          record.state &&
          typeof record.state === "object" &&
          "current" in record.state &&
          record.state.current === null &&
          "connections" in record.state &&
          record.state.connections instanceof Map &&
          record.state.connections.size === 0
        )
          sessionStorage.removeItem(resetKey);
      } catch {
        /* Keep skipping. */
      }
    }
  }));
}

export const walletConfig = createWalletConfig();
