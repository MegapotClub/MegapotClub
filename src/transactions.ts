import { getAddress, isAddress, toHex, type Address, type Hex } from "viem";
import { useEffect, useState } from "react";
import { assertWallet, walletError } from "./wallet.ts";
import { atEvmEndpoint, evmClient, type EvmClient } from "./evmClient.ts";
import { reviewVault, type VaultReview } from "./vaults.ts";
import { localId } from "./localId.ts";
import {
  nativeClient,
  atNativeEndpoint,
  reviewAction,
  type Review,
  type Call,
} from "./native.ts";

export type Journal = {
  schema: 1;
  id: string;
  account: Address;
  chainId: 8453 | 1;
  value?: string;
  to: Address;
  data: Hex;
  kind: Call["kind"] | "vaults";
  hash?: Hex;
  nonce: number;
  nonceConfirmed?: boolean;
  createdAt: number;
  status:
    | "wallet"
    | "pending"
    | "confirmed"
    | "reverted"
    | "replaced"
    | "unknown"
    | "rejected";
};
const KEY = "megapot-club:transactions:v1";
const EVENT = "club:transactions";
let memory: Journal[] = [];
let submitting = false;
let memoryAuthoritative = false;
export const journalStorageAvailable = () => !memoryAuthoritative;
const statuses = [
  "wallet",
  "pending",
  "confirmed",
  "reverted",
  "replaced",
  "unknown",
  "rejected",
];
const kinds = [
  "deposit",
  "withdraw",
  "claim",
  "refund",
  "finalize",
  "referral",
  "cancelSubscription",
  "cancelBatch",
  "emergencyExit",
  "revoke",
  "approve",
  "vaults",
];
export function parseJournal(value: unknown): Journal[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-100)
    .filter(
      (v): v is Journal =>
        v &&
        typeof v === "object" &&
        v.schema === 1 &&
        (v.chainId === 8453 || (v.chainId === 1 && v.kind === "vaults")) &&
        (v.value === undefined ||
          (v.kind === "vaults" &&
            typeof v.value === "string" &&
            /^(0|[1-9]\d{0,77})$/.test(v.value) &&
            BigInt(v.value) < 2n ** 256n)) &&
        typeof v.id === "string" &&
        v.id.length < 80 &&
        typeof v.account === "string" &&
        isAddress(v.account) &&
        typeof v.to === "string" &&
        isAddress(v.to) &&
        typeof v.data === "string" &&
        /^0x(?:[0-9a-fA-F]{2}){4,4096}$/.test(v.data) &&
        (!v.hash || /^0x[0-9a-fA-F]{64}$/.test(v.hash)) &&
        Number.isSafeInteger(v.nonce) &&
        v.nonce >= 0 &&
        (v.nonceConfirmed === undefined ||
          typeof v.nonceConfirmed === "boolean") &&
        Number.isSafeInteger(v.createdAt) &&
        v.createdAt > 0 &&
        statuses.includes(v.status) &&
        kinds.includes(v.kind),
    );
}
export function journals(): Journal[] {
  if (memoryAuthoritative) return memory;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) memory = parseJournal(JSON.parse(saved));
  } catch {
    memoryAuthoritative = true;
  }
  return memory;
}
function write(entry: Journal) {
  memory = [...journals().filter((x) => x.id !== entry.id), entry].slice(-100);
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    memoryAuthoritative = true;
  }
  window.dispatchEvent(new Event(EVENT));
}
export function useTransactions() {
  const [items, setItems] = useState<Journal[]>([]);
  useEffect(() => {
    const update = () => setItems([...journals()]);
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return items;
}
export function forgetUnsubmitted(id: string) {
  const found = journals().find((x) => x.id === id);
  if (found && !found.hash && ["wallet", "unknown"].includes(found.status))
    write({ ...found, status: "rejected" });
}
export function sameCall(
  a: Pick<Journal, "to" | "data" | "value">,
  b: { to: Address | null; input: Hex; value: bigint },
) {
  return (
    a.to.toLowerCase() === b.to?.toLowerCase() &&
    a.data.toLowerCase() === b.input.toLowerCase() &&
    b.value === BigInt(a.value ?? "0")
  );
}
export async function reconcile(
  urls: string[],
  entry: Journal,
  replacementHash?: string,
): Promise<void> {
  if (!entry.hash && !replacementHash) throw new Error("invalidHash");
  if (replacementHash && !/^0x[0-9a-fA-F]{64}$/.test(replacementHash))
    throw new Error("invalidHash");
  const inspect = async (c: EvmClient | ReturnType<typeof nativeClient>) => {
    const hash = (replacementHash ?? entry.hash) as Hex;
    const [receipt, tx] = await Promise.all([
      c.getTransactionReceipt({ hash }),
      c.getTransaction({ hash }),
    ]);
    let originalNonce: number | undefined = entry.nonceConfirmed
      ? entry.nonce
      : undefined;
    if (replacementHash && originalNonce === undefined && entry.hash) {
      try {
        originalNonce = (await c.getTransaction({ hash: entry.hash })).nonce;
      } catch {
        /* The original may have disappeared before it was indexed. */
      }
    }
    const receiptBlock = await c.getBlock({ blockNumber: receipt.blockNumber });
    if (replacementHash) {
      if (tx.from.toLowerCase() !== entry.account.toLowerCase())
        throw new Error("wrongReplacement");
      if (originalNonce !== undefined) {
        if (tx.nonce !== originalNonce) throw new Error("wrongReplacement");
      } else {
        // Manual attribution of a wallet-provided hash is limited to the exact intended effect.
        // Without a known original nonce, a cancellation/different call cannot prove replacement.
        if (
          !sameCall(entry, tx) ||
          tx.nonce < entry.nonce ||
          Number(receiptBlock.timestamp) * 1000 < entry.createdAt - 30_000
        )
          throw new Error("wrongReplacement");
      }
    }
    const head = await c.getBlockNumber();
    if (
      head < receipt.blockNumber + 1n ||
      receiptBlock.hash !== receipt.blockHash
    )
      throw new Error("staleChain");
    const state =
      !sameCall(entry, tx) ||
      tx.from.toLowerCase() !== entry.account.toLowerCase()
        ? "replaced"
        : receipt.status === "success"
          ? "confirmed"
          : "reverted";
    write({
      ...entry,
      hash,
      nonce: tx.nonce,
      nonceConfirmed: true,
      status: state,
    });
  };
  return entry.chainId === 1
    ? atEvmEndpoint(1, urls, inspect)
    : atNativeEndpoint(urls, inspect);
}

/** @cc [label:security] no-implicit-resubmission
 * Every send MUST require an explicit user click, revalidated wallet identity, fresh preflight and exact reviewed calldata.
 * Persisted journals MUST only reconcile receipts, never cause a transaction or signature request.
 * An ambiguous wallet response MUST retain an unresolved record; a timeout MUST NOT cause automatic resubmission.
 */
export async function submitReview(
  urls: string[],
  review: Review,
  walletRevision: number,
  signal?: AbortSignal,
  onFreshReview?: (review: Review) => void,
): Promise<Journal> {
  if (submitting) throw new Error("walletPending");
  const run = async (): Promise<Journal> => {
    if (
      journals().some(
        (x) =>
          x.account.toLowerCase() === review.account.toLowerCase() &&
          x.chainId === 8453 &&
          ["wallet", "unknown", "pending"].includes(x.status),
      )
    )
      throw new Error("unresolvedTransaction");
    const claiming = review.action.kind === "claim";
    if (!claiming && Date.now() - review.createdAt > 120_000)
      throw new Error("reviewExpired");
    if (signal?.aborted) throw new Error("reviewCancelled");
    const w = await assertWallet(review.account, walletRevision);
    const fresh = await reviewAction(urls, review.account, review.action);
    if (fresh.position.contractWallet) throw new Error("contractWallet");
    const call = fresh.calls[0],
      reviewed = review.calls[0];
    if (
      call.to.toLowerCase() !== reviewed.to.toLowerCase() ||
      call.data !== reviewed.data ||
      call.value !== reviewed.value ||
      call.kind !== reviewed.kind ||
      (!claiming &&
        (fresh.amount !== review.amount ||
          fresh.position.draw !== review.position.draw ||
          fresh.position.emergency !== review.position.emergency))
    )
      throw new Error("reviewChanged");
    // A claim has fixed ticket IDs, recipient and calldata, not a swap quote.
    // Fresh ownership, payout and simulation checks still run before every send.
    if (signal?.aborted) throw new Error("reviewCancelled");
    onFreshReview?.(fresh);
    const c = nativeClient([fresh.endpoint]);
    if ((await c.getChainId()) !== 8453) throw new Error("wrongChain");
    const [gas, gasPrice, nonce] = await Promise.all([
      c.estimateGas({
        account: review.account,
        to: call.to,
        data: call.data,
        value: 0n,
      }),
      c.getGasPrice(),
      c.getTransactionCount({ address: review.account, blockTag: "pending" }),
    ]);
    if (fresh.position.ether < gas * gasPrice)
      throw new Error("insufficientGas");
    if ((await assertWallet(review.account, walletRevision)) !== w)
      throw new Error("walletChanged");
    if (signal?.aborted) throw new Error("reviewCancelled");
    let entry: Journal = {
      schema: 1,
      id: localId(),
      account: getAddress(review.account),
      chainId: 8453,
      to: call.to,
      data: call.data,
      kind: call.kind,
      nonce,
      createdAt: Date.now(),
      status: "wallet",
    };
    write(entry);
    try {
      const hash = await w.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: review.account,
            to: call.to,
            data: call.data,
            value: "0x0",
            chainId: "0x2105",
            gas: toHex(gas + gas / 5n),
          },
        ],
      });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw new Error("invalidHash");
      entry = { ...entry, hash: hash as Hex, status: "pending" };
      write(entry);
      try {
        const tx = await c.getTransaction({ hash: entry.hash! });
        entry = { ...entry, nonce: tx.nonce, nonceConfirmed: true };
        write(entry);
      } catch {
        /* The hash is durable even before an RPC can see the transaction. */
      }
      // Monitoring may time out; the journal remains pending and manual reconciliation remains available.
      void c
        .waitForTransactionReceipt({
          hash: entry.hash!,
          timeout: 180_000,
          confirmations: 2,
          onReplaced: (replacement) => {
            entry = {
              ...entry,
              hash: replacement.transaction.hash,
              nonce: replacement.transaction.nonce,
              nonceConfirmed: true,
              status: "pending",
            };
            write(entry);
          },
        })
        .then(() => reconcile(urls, entry))
        .catch(() => {});
      return entry;
    } catch (error) {
      const rejected = walletError(error) === "rejected";
      write({ ...entry, status: rejected ? "rejected" : "unknown" });
      throw new Error(rejected ? "rejected" : "ambiguousTransaction");
    }
  };
  submitting = true;
  try {
    if (navigator.locks)
      return await navigator.locks.request(
        "megapot-club:submit",
        { ifAvailable: true },
        (lock) => {
          if (!lock) throw new Error("walletPending");
          return run();
        },
      );
    return await run();
  } finally {
    submitting = false;
  }
}

/** Vault submission shares the native operation journal and cross-tab mutex. Recovery never resubmits. */
export async function submitVaultReview(
  urls: string[],
  review: VaultReview,
  revision: number,
  signal?: AbortSignal,
): Promise<Journal> {
  if (submitting) throw new Error("walletPending");
  const run = async (): Promise<Journal> => {
    if (
      journals().some(
        (j) =>
          j.account.toLowerCase() === review.account.toLowerCase() &&
          j.chainId === review.chainId &&
          ["wallet", "unknown", "pending"].includes(j.status),
      )
    )
      throw new Error("unresolvedTransaction");
    if (Date.now() - review.createdAt > 120_000)
      throw new Error("reviewExpired");
    if (signal?.aborted) throw new Error("reviewChanged");
    const provider = await assertWallet(
      review.account,
      revision,
      review.chainId,
    );
    const fresh = await reviewVault(
        urls,
        review.product,
        review.account,
        review.intent,
      ),
      call = fresh.call;
    if (fresh.state.contractWallet) throw new Error("contractWallet");
    if (fresh.chainId !== review.chainId) throw new Error("wrongChain");
    if (
      call.to !== review.call.to ||
      call.data !== review.call.data ||
      call.value !== review.call.value ||
      fresh.simulation !== review.simulation ||
      fresh.state.phase !== review.state.phase
    )
      throw new Error("reviewChanged");
    const client = evmClient(review.chainId, fresh.endpoint);
    if ((await client.getChainId()) !== review.chainId)
      throw new Error("wrongChain");
    const [gas, price, nonce] = await Promise.all([
      client.estimateGas({
        account: review.account,
        to: call.to,
        data: call.data,
        value: call.value,
      }),
      client.getGasPrice(),
      client.getTransactionCount({
        address: review.account,
        blockTag: "pending",
      }),
    ]);
    if (fresh.state.ether < call.value + (gas + gas / 5n) * price)
      throw new Error("insufficientGas");
    if (
      (await assertWallet(review.account, revision, review.chainId)) !==
      provider
    )
      throw new Error("walletChanged");
    if (signal?.aborted) throw new Error("reviewChanged");
    let entry: Journal = {
      schema: 1,
      id: localId(),
      account: review.account,
      chainId: review.chainId,
      value: call.value.toString(),
      to: call.to,
      data: call.data,
      kind: "vaults",
      nonce,
      createdAt: Date.now(),
      status: "wallet",
    };
    write(entry);
    try {
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: entry.account,
            to: entry.to,
            data: entry.data,
            value: toHex(call.value),
            chainId: toHex(entry.chainId),
            gas: toHex(gas + gas / 5n),
          },
        ],
      });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw new Error("invalidHash");
      entry = { ...entry, hash: hash as Hex, status: "pending" };
      write(entry);
      try {
        const tx = await client.getTransaction({ hash: entry.hash! });
        entry = { ...entry, nonce: tx.nonce, nonceConfirmed: true };
        write(entry);
      } catch {
        /* Keep the durable hash while the RPC catches up. */
      }
      void client
        .waitForTransactionReceipt({
          hash: entry.hash!,
          timeout: 180_000,
          confirmations: 2,
          onReplaced: (r) => {
            entry = {
              ...entry,
              hash: r.transaction.hash,
              nonce: r.transaction.nonce,
              nonceConfirmed: true,
              status: "pending",
            };
            write(entry);
          },
        })
        .then(() => reconcile(urls, entry))
        .catch(() => {});
      return entry;
    } catch (e) {
      const rejected = walletError(e) === "rejected";
      write({ ...entry, status: rejected ? "rejected" : "unknown" });
      throw new Error(rejected ? "rejected" : "ambiguousTransaction");
    }
  };
  submitting = true;
  try {
    return navigator.locks
      ? await navigator.locks.request(
          "megapot-club:submit",
          { ifAvailable: true },
          (lock) => {
            if (!lock) throw new Error("walletPending");
            return run();
          },
        )
      : await run();
  } finally {
    submitting = false;
  }
}

export function downloadJSON(name: string, value: unknown) {
  const blob = new Blob(
    [
      JSON.stringify(
        value,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
