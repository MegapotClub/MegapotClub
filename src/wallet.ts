import { useSyncExternalStore } from "react";
import {
  getAccount,
  watchAccount,
  switchChain as wagmiSwitchChain,
} from "wagmi/actions";
import type { Config } from "wagmi";
import { getAddress, isAddress, type Address } from "viem";
import { walletConfig } from "./walletConfig.ts";

export type WalletProvider = {
  request(args: {
    method: string;
    params?: readonly unknown[] | object;
  }): Promise<unknown>;
};
const initial = {
  account: null as Address | null,
  chainId: null as number | null,
  name: "",
  connecting: false,
  error: null as string | null,
  revision: 0,
};
const accountFrom = (value: unknown) =>
  Array.isArray(value) && typeof value[0] === "string" && isAddress(value[0])
    ? getAddress(value[0])
    : null;

/**
 * @cc [label:security] explicit-wallet-connection
 * wagmi owns connection state. Every observed account, chain, connector or
 * connection-status change MUST invalidate prior transaction reviews. This
 * adapter MUST never request accounts or signatures. Startup restoration uses
 * the library connector separately and MUST NOT restore a signing review.
 */
export function createWalletSession(config: Config) {
  let snapshot = initial;
  let connectedProvider: Promise<WalletProvider | undefined> =
    Promise.resolve(undefined);
  const listeners = new Set<() => void>();
  const sync = () => {
    const account = getAccount(config);
    // Some legacy injected connectors look up window.ethereum on every call.
    // Pin its identity at connection time; a silent replacement requires reconnect.
    connectedProvider = (async () =>
      account.status === "connected"
        ? ((await account.connector.getProvider()) as WalletProvider)
        : undefined)().catch(() => undefined);
    snapshot = {
      account:
        account.status === "connected" ? (account.address ?? null) : null,
      chainId:
        account.status === "connected" ? (account.chainId ?? null) : null,
      name: account.connector?.name ?? "",
      connecting: account.isConnecting || account.isReconnecting,
      error: null,
      revision: snapshot.revision + 1,
    };
    listeners.forEach((fn) => fn());
  };
  const stop = watchAccount(config, { onChange: sync });
  sync();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const current = () => snapshot;
  const assertIdentity = (
    account: Address,
    revision: number,
    chainId: number,
  ) => {
    const state = getAccount(config);
    if (
      snapshot.revision !== revision ||
      state.status !== "connected" ||
      state.address?.toLowerCase() !== account.toLowerCase() ||
      state.chainId !== chainId ||
      !state.connector
    )
      throw new Error("walletChanged");
    return state.connector;
  };
  return {
    current,
    stop,
    useWallet: () => useSyncExternalStore(subscribe, current, () => initial),
    async assertWallet(
      account: Address,
      revision: number,
      chainId: 1 | 8453 = 8453,
    ) {
      const connector = assertIdentity(account, revision, chainId);
      const expectedProvider = await connectedProvider;
      const provider = (await connector.getProvider()) as
        | WalletProvider
        | undefined;
      if (
        !provider ||
        provider !== expectedProvider ||
        typeof provider.request !== "function" ||
        assertIdentity(account, revision, chainId) !== connector
      )
        throw new Error("walletChanged");
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      if (
        accountFrom(accounts)?.toLowerCase() !== account.toLowerCase() ||
        typeof chain !== "string" ||
        !/^0x[0-9a-f]+$/i.test(chain) ||
        Number(chain) !== chainId ||
        (await connector.getProvider()) !== provider ||
        assertIdentity(account, revision, chainId) !== connector
      )
        throw new Error("walletChanged");
      return provider;
    },
    async switchChain(chainId: 1 | 8453, urls: string[]) {
      const state = getAccount(config);
      if (!state.address || !state.connector || state.status !== "connected")
        throw new Error("connectFirst");
      await wagmiSwitchChain(config, {
        connector: state.connector,
        chainId,
        addEthereumChainParameter: { rpcUrls: urls },
      });
      const after = getAccount(config);
      if (
        after.connector?.uid !== state.connector.uid ||
        after.address?.toLowerCase() !== state.address.toLowerCase() ||
        after.chainId !== chainId ||
        after.status !== "connected"
      )
        throw new Error("walletChanged");
    },
  };
}
const session = createWalletSession(walletConfig);
export const useWallet = session.useWallet;
export const currentWallet = session.current;
export const assertWallet = session.assertWallet;
export const switchChain = session.switchChain;
export const switchBase = (urls: string[]) => switchChain(8453, urls);

export function walletError(error: unknown): string {
  let value = error;
  for (
    let depth = 0;
    depth < 6 && value && typeof value === "object";
    depth++
  ) {
    const item = value as { code?: unknown; name?: unknown; cause?: unknown };
    if (
      item.code === 4001 ||
      item.code === "ACTION_REJECTED" ||
      item.name === "UserRejectedRequestError"
    )
      return "rejected";
    if (item.code === -32002) return "walletPending";
    value = item.cause;
  }
  return "walletFailed";
}
