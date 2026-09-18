import { createPublicClient } from "viem";
import { rpcHttp } from "./rpcTransport.ts";
import { base, mainnet } from "viem/chains";
import { parseRpcUrls } from "./model.ts";

export type VaultChain = 1 | 8453;
export const chainExplorer = (chain: VaultChain) =>
  chain === 1 ? "https://etherscan.io" : "https://basescan.org";
export const evmClient = (
  chainId: VaultChain,
  endpoint: string,
  signal?: AbortSignal,
) =>
  createPublicClient({
    chain: chainId === 1 ? mainnet : base,
    ccipRead: false,
    transport: rpcHttp(endpoint, {
      timeout: 12_000,
      retryCount: 0,
      fetchOptions: {
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
      },
    }),
  });
export type EvmClient = ReturnType<typeof evmClient>;

/** @cc [label:security] chain-scoped-observation
 * A fallback retries the entire observation. No RPC endpoint can change the expected chain.
 */
export async function atEvmEndpoint<T>(
  chain: VaultChain,
  urls: string[],
  work: (client: EvmClient, endpoint: string) => Promise<T>,
): Promise<T> {
  let last: unknown = new Error("rpcUnavailable");
  for (const endpoint of parseRpcUrls(urls)) {
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const client = evmClient(chain, endpoint, abort.signal);
      if ((await client.getChainId()) !== chain) throw new Error("wrongChain");
      return await work(client, endpoint);
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
  throw last;
}
