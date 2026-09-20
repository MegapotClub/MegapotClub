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

// Bound passive transport reads only. Signing and network-switch requests are
// never retried or declared unsent merely because a response takes time.
async function passiveRead<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("walletUnavailable")),
          12_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @cc [label:security] explicit-wallet-connection
 * wagmi owns connection state. Account, connector and connection-status changes
 * MUST invalidate in-flight authorization. Wallet selection MUST NOT determine a
 * transaction target. Passive validation MUST never request authorization.
 * Target preparation may switch a legacy connector only during an explicit send.
 */
export function createWalletSession(config: Config) {
  let snapshot = initial;
  let connectedProvider: Promise<WalletProvider | undefined> =
    Promise.resolve(undefined);
  const listeners = new Set<() => void>();
  let identity = "";
  let chainRevision = 0;
  const sync = () => {
    const account = getAccount(config);
    // Some legacy injected connectors look up window.ethereum on every call.
    // Pin its identity at connection time; a silent replacement requires reconnect.
    const nextIdentity = `${account.status}:${account.address?.toLowerCase()}:${account.connector?.uid}`;
    const changed = nextIdentity !== identity;
    identity = nextIdentity;
    if (changed)
      connectedProvider = (async () =>
        account.status === "connected"
          ? ((await account.connector.getProvider()) as WalletProvider)
          : undefined)().catch(() => undefined);
    if (account.chainId !== snapshot.chainId) chainRevision++;
    snapshot = {
      account:
        account.status === "connected" ? (account.address ?? null) : null,
      chainId:
        account.status === "connected" ? (account.chainId ?? null) : null,
      name: account.connector?.name ?? "",
      connecting: account.isConnecting || account.isReconnecting,
      error: null,
      revision: snapshot.revision + Number(changed),
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
  const assertIdentity = (account: Address, revision: number) => {
    const state = getAccount(config);
    if (
      snapshot.revision !== revision ||
      state.status !== "connected" ||
      state.address?.toLowerCase() !== account.toLowerCase() ||
      !state.connector
    )
      throw new Error("walletChanged");
    return state.connector;
  };
  const session = {
    current,
    stop,
    useWallet: () => useSyncExternalStore(subscribe, current, () => initial),
    async assertWallet(
      account: Address,
      revision: number,
      _chainId: 1 | 8453 = 8453,
    ) {
      const connector = assertIdentity(account, revision);
      const expectedProvider = await passiveRead(connectedProvider);
      const provider = (await passiveRead(connector.getProvider())) as
        | WalletProvider
        | undefined;
      if (
        !provider ||
        provider !== expectedProvider ||
        typeof provider.request !== "function" ||
        assertIdentity(account, revision) !== connector
      )
        throw new Error("walletChanged");
      const accounts = await passiveRead(
        provider.request({ method: "eth_accounts" }),
      );
      if (
        accountFrom(accounts)?.toLowerCase() !== account.toLowerCase() ||
        (await passiveRead(connector.getProvider())) !== provider ||
        assertIdentity(account, revision) !== connector
      )
        throw new Error("walletChanged");
      return provider;
    },
    async assertTarget(account: Address, revision: number, chainId: 1 | 8453) {
      const provider = await session.assertWallet(account, revision);
      const connector = assertIdentity(account, revision),
        epoch = chainRevision;
      const chain = await passiveRead(
        provider.request({ method: "eth_chainId" }),
      );
      const latestProvider = await passiveRead(connector.getProvider());
      if (
        typeof chain !== "string" ||
        !/^0x[0-9a-f]+$/i.test(chain) ||
        Number(chain) !== chainId ||
        epoch !== chainRevision
      )
        throw new Error("walletTargetFailed");
      if (
        latestProvider !== provider ||
        assertIdentity(account, revision) !== connector
      )
        throw new Error("walletChanged");
      return provider;
    },
    async prepareTarget(
      account: Address,
      revision: number,
      chainId: 1 | 8453,
      urls: string[],
      onWalletRequest?: () => void,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) throw new Error("reviewCancelled");
      const provider = await session.assertWallet(account, revision);
      const chain = await passiveRead(
        provider.request({ method: "eth_chainId" }),
      );
      if (signal?.aborted) throw new Error("reviewCancelled");
      if (Number(chain) !== chainId) {
        onWalletRequest?.();
        await session.switchChain(chainId, urls);
      }
      if ((await session.assertTarget(account, revision, chainId)) !== provider)
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
  return session;
}
const session = createWalletSession(walletConfig);
export const useWallet = session.useWallet;
export const currentWallet = session.current;
export const assertWallet = session.assertWallet;
export const prepareWalletTarget = session.prepareTarget;
export const assertWalletTarget = session.assertTarget;

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
    if (item.code === -32002) return "walletNoResponse";
    value = item.cause;
  }
  return "walletFailed";
}

/** Structured refusal is distinct from response loss after a request was dispatched. */
export function walletRequestRefused(error: unknown): boolean {
  if (walletError(error) === "rejected") return true;
  let value = error;
  for (
    let depth = 0;
    depth < 6 && value && typeof value === "object";
    depth++
  ) {
    const item = value as { code?: unknown; cause?: unknown };
    if ([4100, 4200, -32002, -32601, -32602].includes(item.code as number))
      return true;
    value = item.cause;
  }
  return false;
}
