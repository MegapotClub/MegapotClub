import {
  getAddress,
  isAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { useEffect, useState } from "react";
import { assertWallet, walletError } from "./wallet.ts";
import { atEvmEndpoint, evmClient, type EvmClient } from "./evmClient.ts";
import { reviewVault, type VaultReview } from "./vaults.ts";
import { localId } from "./localId.ts";
import { purchaseReceipt, claimReceipt } from "./purchaseReceipt.ts";
import { JACKPOT } from "./config.ts";
import { useQuery } from "@tanstack/react-query";
import {
  nativeClient,
  atNativeEndpoint,
  reviewAction,
  type Review,
  type Call,
  type Action,
  purchaseTickets,
  actionCalls,
  jackpotAbi,
} from "./native.ts";

export type Journal = {
  schema: 1 | 2;
  id: string;
  account: Address;
  chainId: 8453 | 1;
  value?: string;
  to: Address;
  data?: Hex;
  callHash?: Hex;
  purchase?: StoredPurchase;
  purchaseReceipt?: { draw: string; ticketIds: string[]; paid: string };
  claimReceipt?: { amount: string; ticketIds: string[] };
  recovery?: { fromBlock: string; nextBlock: string; candidates: Hex[] };
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
type Purchase = Extract<Action, { kind: "purchase" }>;
export type StoredPurchase = Omit<Purchase, "unitPrice" | "drawId"> & {
  unitPrice: string;
  drawId: string;
};
export const JOURNAL_KEY = "megapot-club:transactions:v1";
const EVENT = "club:transactions";
const MAX_STORAGE_CHARS = 400_000;
const MAX_RESOLVED = 60;
const UNRESOLVED = new Set(["wallet", "pending", "unknown"]);
let memory: Journal[] = [];
let submitting = false;
let storageFailed = false;
export const journalStorageAvailable = () => !storageFailed;
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
  "purchase",
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
const uint = (v: unknown): v is string =>
  typeof v === "string" &&
  /^(0|[1-9]\d{0,77})$/.test(v) &&
  BigInt(v) < 2n ** 256n;
const hashValue = (v: unknown): v is Hex =>
  typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
export function restorePurchase(value: unknown): Purchase | null {
  if (!value || typeof value !== "object") return null;
  const p = value as StoredPurchase;
  try {
    if (
      p.kind !== "purchase" ||
      !uint(p.unitPrice) ||
      BigInt(p.unitPrice) <= 0n ||
      !uint(p.drawId) ||
      !isAddress(p.recipient) ||
      !isAddress(p.referrer) ||
      !p.orderId ||
      p.orderId.length > 80 ||
      (p.draftKey !== undefined && !hashValue(p.draftKey))
    )
      return null;
    const action = {
      kind: "purchase" as const,
      tickets: purchaseTickets(p.tickets),
      recipient: p.recipient,
      referrer: p.referrer,
      orderId: p.orderId,
      draftKey: p.draftKey,
      unitPrice: BigInt(p.unitPrice),
      drawId: BigInt(p.drawId),
    };
    actionCalls(action);
    return action;
  } catch {
    return null;
  }
}
export function storedPurchase(action: Purchase): StoredPurchase {
  return {
    ...action,
    tickets: purchaseTickets(action.tickets),
    orderId: action.orderId ?? localId(),
    drawId: action.drawId.toString(),
    unitPrice: action.unitPrice.toString(),
  };
}
export function parseJournal(value: unknown): Journal[] {
  if (!Array.isArray(value) || value.length > 2000) return [];
  const valid: Journal[] = [];
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const v = row as Journal;
    if (ids.has(v.id)) continue;
    ids.add(v.id);
    const hasData =
      typeof v.data === "string" &&
      /^0x(?:[0-9a-fA-F]{2}){4,32768}$/.test(v.data);
    if (
      (v.schema !== 1 && v.schema !== 2) ||
      (v.chainId !== 8453 && !(v.chainId === 1 && v.kind === "vaults")) ||
      (v.value !== undefined && !(v.kind === "vaults" && uint(v.value))) ||
      typeof v.id !== "string" ||
      !v.id ||
      v.id.length > 80 ||
      typeof v.account !== "string" ||
      !isAddress(v.account) ||
      typeof v.to !== "string" ||
      !isAddress(v.to) ||
      (!hasData && !(v.schema === 2 && hashValue(v.callHash))) ||
      (v.callHash !== undefined &&
        (!hashValue(v.callHash) ||
          (hasData && keccak256(v.data!) !== v.callHash))) ||
      (v.hash !== undefined && !hashValue(v.hash)) ||
      !Number.isSafeInteger(v.nonce) ||
      v.nonce < 0 ||
      (v.nonceConfirmed !== undefined &&
        typeof v.nonceConfirmed !== "boolean") ||
      !Number.isSafeInteger(v.createdAt) ||
      v.createdAt <= 0 ||
      !statuses.includes(v.status) ||
      !kinds.includes(v.kind)
    )
      continue;
    const purchase =
      v.purchase === undefined ? undefined : restorePurchase(v.purchase);
    if (
      v.purchase !== undefined &&
      (!purchase ||
        purchase.recipient.toLowerCase() !== v.account.toLowerCase())
    )
      continue;
    if (purchase) {
      if (v.kind !== "approve" && v.kind !== "purchase") continue;
      const call = actionCalls(
        purchase,
        v.kind === "approve" ? 0n : 2n ** 256n - 1n,
      )[0];
      if (
        !sameCall(
          { ...v, callHash: hasData ? keccak256(v.data!) : v.callHash },
          { to: call.to, input: call.data, value: call.value },
        )
      )
        continue;
    }
    const result: Journal = {
      schema: 2,
      id: v.id,
      account: getAddress(v.account),
      chainId: v.chainId,
      to: getAddress(v.to),
      callHash: hasData ? keccak256(v.data!) : v.callHash,
      value: v.value,
      kind: v.kind,
      hash: v.hash,
      nonce: v.nonce,
      nonceConfirmed: v.nonceConfirmed,
      createdAt: v.createdAt,
      status: v.status,
      ...(purchase ? { purchase: storedPurchase(purchase) } : {}),
    };
    if (
      v.recovery &&
      uint(v.recovery.fromBlock) &&
      uint(v.recovery.nextBlock) &&
      BigInt(v.recovery.nextBlock) >= BigInt(v.recovery.fromBlock) &&
      Array.isArray(v.recovery.candidates) &&
      v.recovery.candidates.length <= 5 &&
      v.recovery.candidates.every(hashValue)
    )
      result.recovery = {
        fromBlock: v.recovery.fromBlock,
        nextBlock: v.recovery.nextBlock,
        candidates: [...new Set(v.recovery.candidates)],
      };
    const receipt = v.purchaseReceipt;
    if (
      receipt &&
      uint(receipt.draw) &&
      uint(receipt.paid) &&
      Array.isArray(receipt.ticketIds) &&
      receipt.ticketIds.length >= 1 &&
      receipt.ticketIds.length <= 100 &&
      receipt.ticketIds.every(uint)
    )
      result.purchaseReceipt = {
        draw: receipt.draw,
        paid: receipt.paid,
        ticketIds: [...receipt.ticketIds],
      };
    if (
      v.claimReceipt &&
      uint(v.claimReceipt.amount) &&
      Array.isArray(v.claimReceipt.ticketIds) &&
      v.claimReceipt.ticketIds.length <= 30 &&
      v.claimReceipt.ticketIds.every(uint)
    )
      result.claimReceipt = {
        amount: v.claimReceipt.amount,
        ticketIds: [...v.claimReceipt.ticketIds],
      };
    valid.push(result);
  }
  // All unresolved records survive regardless of resolved-history age/count.
  return [
    ...valid.filter((j) => UNRESOLVED.has(j.status)),
    ...valid.filter((j) => !UNRESOLVED.has(j.status)).slice(-MAX_RESOLVED),
  ].sort((a, b) => a.createdAt - b.createdAt);
}
export function journals(): Journal[] {
  try {
    const saved = localStorage.getItem(JOURNAL_KEY);
    if (saved && saved.length > 2_000_000) throw new Error("journalTooLarge");
    const raw: unknown = saved ? JSON.parse(saved) : [];
    const parsed = parseJournal(raw);
    // An unreadable or invalid unresolved record is not evidence that no transaction was sent.
    if (
      !Array.isArray(raw) ||
      new Set(raw.map((v) => v?.id)).size !== raw.length ||
      raw.some(
        (v) =>
          !v ||
          typeof v !== "object" ||
          ((!statuses.includes(v.status) || UNRESOLVED.has(v.status)) &&
            !parsed.some((p) => p.id === v.id)),
      )
    )
      throw new Error("journalUnrecognized");
    if (!storageFailed) memory = parsed;
  } catch {
    storageFailed = true;
  }
  return memory;
}
/** Every read/modify/write shares this mutex across tabs, including receipt and recovery writes. */
export async function writeJournal(
  entry: Journal,
  requireDurable = false,
): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new Error("trackingUnavailable");
  await navigator.locks.request("megapot-club:journal-write", async () => {
    const previous = journals();
    const current = previous.find((x) => x.id === entry.id);
    if (current && !UNRESOLVED.has(current.status)) return;
    if (
      current &&
      !sameCall(current, {
        to: entry.to,
        input: entry.data ?? "0x",
        value: BigInt(entry.value ?? "0"),
      }) &&
      current.callHash !== entry.callHash
    )
      throw new Error("trackingUnavailable");
    if (current?.hash && !entry.hash)
      entry = {
        ...entry,
        hash: current.hash,
        status: current.status,
        nonce: current.nonce,
        nonceConfirmed: current.nonceConfirmed,
      };
    if (current?.nonceConfirmed && !entry.nonceConfirmed)
      entry = { ...entry, nonce: current.nonce, nonceConfirmed: true };
    if (current?.recovery)
      entry = {
        ...entry,
        recovery: {
          ...current.recovery,
          nextBlock:
            BigInt(current.recovery.nextBlock) >
            BigInt(entry.recovery?.nextBlock ?? "0")
              ? current.recovery.nextBlock
              : entry.recovery!.nextBlock,
          candidates: [
            ...new Set([
              ...current.recovery.candidates,
              ...(entry.recovery?.candidates ?? []),
            ]),
          ].slice(0, 5),
        },
      };
    entry = {
      ...entry,
      createdAt:
        current?.createdAt ??
        Math.max(entry.createdAt, ...previous.map((x) => x.createdAt + 1)),
    };
    let next = parseJournal([
      ...previous.filter((x) => x.id !== entry.id),
      entry,
    ]);
    if (!next.some((x) => x.id === entry.id))
      throw new Error("trackingUnavailable");
    while (
      JSON.stringify(next).length > MAX_STORAGE_CHARS &&
      next.some((x) => !UNRESOLVED.has(x.status) && x.id !== entry.id)
    )
      next.splice(
        next.findIndex((x) => !UNRESOLVED.has(x.status) && x.id !== entry.id),
        1,
      );
    const encoded = JSON.stringify(next);
    if (encoded.length > MAX_STORAGE_CHARS || (requireDurable && storageFailed))
      throw new Error("trackingUnavailable");
    memory = next;
    try {
      localStorage.setItem(JOURNAL_KEY, encoded);
      if (localStorage.getItem(JOURNAL_KEY) !== encoded)
        throw new Error("journalNotSaved");
    } catch {
      storageFailed = true;
      if (requireDurable) {
        memory = next.map((x) =>
          x.id === entry.id ? { ...x, status: "rejected" as const } : x,
        );
        // No wallet method has been invoked. Best-effort cleanup if setItem succeeded but its read-back failed.
        try {
          localStorage.setItem(JOURNAL_KEY, JSON.stringify(memory));
        } catch {}
        window.dispatchEvent(new Event(EVENT));
        throw new Error("trackingUnavailable");
      }
    }
    window.dispatchEvent(new Event(EVENT));
  });
}
const write = writeJournal;
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
export function sameCall(
  a: Pick<Journal, "to" | "data" | "callHash" | "value">,
  b: { to: Address | null; input: Hex; value: bigint },
) {
  return (
    a.to.toLowerCase() === b.to?.toLowerCase() &&
    (a.callHash ?? (a.data ? keccak256(a.data) : undefined)) ===
      keccak256(b.input) &&
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
    if (tx.from.toLowerCase() !== entry.account.toLowerCase())
      throw new Error("wrongReplacement");
    if (
      !sameCall(entry, tx) &&
      (originalNonce === undefined || tx.nonce !== originalNonce)
    )
      throw new Error("wrongReplacement");
    const state =
      !sameCall(entry, tx) ||
      tx.from.toLowerCase() !== entry.account.toLowerCase()
        ? "replaced"
        : receipt.status === "success"
          ? "confirmed"
          : "reverted";
    await write({
      ...entry,
      hash,
      nonce: tx.nonce,
      nonceConfirmed: true,
      status: state,
      ...(state === "confirmed" && entry.kind === "purchase" && entry.purchase
        ? {
            purchaseReceipt: purchaseReceipt(
              receipt.logs,
              restorePurchase(entry.purchase)!,
            ),
          }
        : {}),
      ...(state === "confirmed" && entry.kind === "claim"
        ? { claimReceipt: claimReceipt(receipt.logs, entry.account) }
        : {}),
    });
  };
  return entry.chainId === 1
    ? atEvmEndpoint(1, urls, inspect)
    : atNativeEndpoint(urls, inspect);
}

/** A lost response has no trustworthy hash or wallet-selected nonce. Find candidates without
 * treating an unrelated same-account call as proof, and never clear/resubmit automatically. */
export async function findPurchaseCandidates(
  urls: string[],
  entry: Journal,
): Promise<void> {
  if (
    entry.hash ||
    entry.kind !== "purchase" ||
    !entry.purchase ||
    !entry.recovery
  )
    return;
  await atNativeEndpoint(urls, async (c) => {
    const head = await c.getBlockNumber(),
      from = BigInt(entry.recovery!.nextBlock);
    if (head < from + 1n) return;
    const to = from + 1999n < head - 1n ? from + 1999n : head - 1n;
    const logs = await c.getContractEvents({
      address: JACKPOT,
      abi: jackpotAbi,
      eventName: "TicketOrderProcessed",
      args: { buyer: entry.account, recipient: entry.account },
      fromBlock: from,
      toBlock: to,
      strict: true,
    });
    const candidates = new Set(entry.recovery!.candidates);
    // Stay bounded even if the account has many unrelated purchases in the scanned range.
    if (logs.length > 20) return;
    for (const hash of [...new Set(logs.map((log) => log.transactionHash))]) {
      const tx = await c.getTransaction({ hash });
      if (
        tx.from.toLowerCase() === entry.account.toLowerCase() &&
        tx.nonce >= entry.nonce &&
        sameCall(entry, tx)
      )
        candidates.add(hash);
    }
    if (candidates.size > 5) return;
    const latest = journals().find((j) => j.id === entry.id);
    if (latest && !latest.hash && UNRESOLVED.has(latest.status))
      await write({
        ...latest,
        recovery: {
          ...entry.recovery!,
          nextBlock: (to + 1n).toString(),
          candidates: [...candidates],
        },
      });
  });
}

/** Receipt polling is mounted once by the shell and never invokes the wallet. */
export function useTransactionRecovery(urls: string[]) {
  const items = useTransactions();
  const pending = items.filter(
    (e) => e.chainId === 8453 && UNRESOLVED.has(e.status),
  );
  useQuery({
    queryKey: [
      "transaction-recovery",
      urls,
      pending.map((e) => `${e.id}:${e.hash}`).join(","),
    ],
    enabled: pending.length > 0,
    queryFn: async () => {
      for (const entry of pending.slice(0, 5)) {
        if (entry.hash) await reconcile(urls, entry).catch(() => {});
        else await findPurchaseCandidates(urls, entry).catch(() => {});
      }
      return Date.now();
    },
    staleTime: 12_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
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
    const retail = ["purchase", "claim", "refund", "referral"].includes(
      review.action.kind,
    );
    if (!retail && Date.now() - review.createdAt > 120_000)
      throw new Error("reviewExpired");
    if (signal?.aborted) throw new Error("reviewCancelled");
    const w = await assertWallet(review.account, walletRevision);
    const fresh = await reviewAction(
      urls,
      review.account,
      review.action,
      signal,
    );
    if (fresh.position.contractWallet) throw new Error("contractWallet");
    const call = fresh.calls[0],
      reviewed = review.calls[0];
    onFreshReview?.(fresh);
    if (call.kind !== reviewed.kind) throw new Error("actionUpdated");
    if (
      call.to.toLowerCase() !== reviewed.to.toLowerCase() ||
      call.data !== reviewed.data ||
      call.value !== reviewed.value ||
      call.kind !== reviewed.kind ||
      (!retail &&
        (fresh.amount !== review.amount ||
          fresh.position.draw !== review.position.draw ||
          fresh.position.emergency !== review.position.emergency))
    )
      throw new Error("reviewChanged");
    // A claim has fixed ticket IDs, recipient and calldata, not a swap quote.
    // Fresh ownership, payout and simulation checks still run before every send.
    if (signal?.aborted) throw new Error("reviewCancelled");
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
      schema: 2,
      id: localId(),
      account: getAddress(review.account),
      chainId: 8453,
      to: call.to,
      data: call.data,
      kind: call.kind,
      ...(fresh.action.kind === "purchase"
        ? { purchase: storedPurchase(fresh.action) }
        : {}),
      nonce,
      recovery: {
        fromBlock: fresh.block.toString(),
        nextBlock: fresh.block.toString(),
        candidates: [],
      },
      createdAt: Date.now(),
      status: "wallet",
    };
    try {
      await write(entry, true);
      if (signal?.aborted) throw new Error("reviewCancelled");
      if ((await assertWallet(review.account, walletRevision)) !== w)
        throw new Error("walletChanged");
      if (signal?.aborted) throw new Error("reviewCancelled");
    } catch (error) {
      await write({ ...entry, status: "rejected" }).catch(() => {});
      throw error;
    }
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
      await write(entry);
      try {
        const tx = await c.getTransaction({ hash: entry.hash! });
        if (
          tx.from.toLowerCase() !== entry.account.toLowerCase() ||
          !sameCall(entry, tx)
        )
          throw new Error("wrongReplacement");
        entry = { ...entry, nonce: tx.nonce, nonceConfirmed: true };
        await write(entry);
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
            void write(entry).catch(() => {});
          },
        })
        .then(() => reconcile(urls, entry))
        .catch(() => {});
      return entry;
    } catch (error) {
      const rejected = walletError(error) === "rejected";
      await write({ ...entry, status: rejected ? "rejected" : "unknown" });
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
    throw new Error("trackingUnavailable");
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
      schema: 2,
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
    try {
      await write(entry, true);
      if (signal?.aborted) throw new Error("reviewCancelled");
      if (
        (await assertWallet(review.account, revision, review.chainId)) !==
        provider
      )
        throw new Error("walletChanged");
      if (signal?.aborted) throw new Error("reviewCancelled");
    } catch (error) {
      await write({ ...entry, status: "rejected" }).catch(() => {});
      throw error;
    }
    try {
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: entry.account,
            to: entry.to,
            data: call.data,
            value: toHex(call.value),
            chainId: toHex(entry.chainId),
            gas: toHex(gas + gas / 5n),
          },
        ],
      });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
        throw new Error("invalidHash");
      entry = { ...entry, hash: hash as Hex, status: "pending" };
      await write(entry);
      try {
        const tx = await client.getTransaction({ hash: entry.hash! });
        if (
          tx.from.toLowerCase() !== entry.account.toLowerCase() ||
          !sameCall(entry, tx)
        )
          throw new Error("wrongReplacement");
        entry = { ...entry, nonce: tx.nonce, nonceConfirmed: true };
        await write(entry);
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
            void write(entry).catch(() => {});
          },
        })
        .then(() => reconcile(urls, entry))
        .catch(() => {});
      return entry;
    } catch (e) {
      const rejected = walletError(e) === "rejected";
      await write({ ...entry, status: rejected ? "rejected" : "unknown" });
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
      : Promise.reject(new Error("trackingUnavailable"));
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
