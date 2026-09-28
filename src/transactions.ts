import {
  getAddress,
  isAddress,
  keccak256,
  toHex,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type RpcTransactionRequest,
} from "viem";
import { useEffect, useRef, useState } from "react";
import {
  assertWallet,
  prepareWalletTarget,
  assertWalletTarget,
  walletRequestRefused,
  walletError,
  type WalletProvider,
} from "./wallet.ts";
import { atEvmEndpoint, evmClient, type EvmClient } from "./evmClient.ts";
import { reviewVault, type VaultReview } from "./vaults.ts";
import { localId } from "./localId.ts";
import { purchaseReceipt, claimReceipt } from "./purchaseReceipt.ts";
import { accountOperations } from "./userOperation.ts";
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
  retryOf?: string;
  resolvedBy?: Hex;
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
    | "rejected"
    | "superseded";
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
  "superseded",
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
    if (
      typeof v.retryOf === "string" &&
      v.retryOf.length > 0 &&
      v.retryOf.length <= 80 &&
      v.retryOf !== v.id
    )
      result.retryOf = v.retryOf;
    if (v.status === "superseded") {
      if (v.kind !== "claim" || v.hash || !hashValue(v.resolvedBy)) continue;
      result.resolvedBy = v.resolvedBy;
    }
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
  walletResponse = false,
): Promise<Journal> {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new Error("trackingUnavailable");
  return navigator.locks.request("megapot-club:journal-write", async () => {
    const previous = journals();
    let current = previous.find((x) => x.id === entry.id);
    // A candidate discovered for a hashless attempt is not proof that a later
    // wallet response refers to that transaction. Preserve both distinct hashes.
    if (
      walletResponse &&
      entry.hash &&
      current?.hash &&
      entry.hash !== current.hash
    ) {
      entry = {
        ...entry,
        id: `wallet-${entry.chainId}-${entry.hash.slice(2)}`,
        retryOf: current.id,
      };
      current = previous.find((x) => x.id === entry.id);
    }
    if (
      current &&
      (current.account.toLowerCase() !== entry.account.toLowerCase() ||
        current.chainId !== entry.chainId ||
        current.kind !== entry.kind ||
        current.to.toLowerCase() !== entry.to.toLowerCase() ||
        BigInt(current.value ?? "0") !== BigInt(entry.value ?? "0") ||
        (current.data ? keccak256(current.data) : current.callHash) !==
          (entry.data ? keccak256(entry.data) : entry.callHash))
    )
      throw new Error("trackingUnavailable");
    if (
      current &&
      !UNRESOLVED.has(current.status) &&
      !(
        current.status === "superseded" &&
        walletResponse &&
        entry.hash &&
        ["pending", "confirmed", "reverted", "replaced"].includes(entry.status)
      )
    )
      return current;
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
    return entry;
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
  signal?: AbortSignal,
): Promise<void> {
  if (!entry.hash && !replacementHash) throw new Error("invalidHash");
  if (replacementHash && !/^0x[0-9a-fA-F]{64}$/.test(replacementHash))
    throw new Error("invalidHash");
  const inspect = async (c: EvmClient | ReturnType<typeof nativeClient>) => {
    const hash = (replacementHash ?? entry.hash) as Hex;
    // A healthy RPC returning no receipt means pending/not yet indexed. It is
    // not an endpoint failure and must not fan out to the fallback provider.
    const receipt = await c.getTransactionReceipt({ hash }).catch((error) => {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    });
    if (!receipt) return;
    const tx = await c.getTransaction({ hash });
    const direct = tx.from.toLowerCase() === entry.account.toLowerCase();
    // Smart-account wallets, including EIP-7702 upgraded EOAs, may execute the
    // exact reviewed call as this account's operation inside an ERC-4337 bundle.
    const operation = direct
      ? undefined
      : accountOperations(tx, receipt, entry.account)
          .map((op) => ({
            ...op,
            call: op.calls.find((call) => sameCall(entry, call)),
          }))
          .find((op) => op.call);
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
    const afterAttempt = entry.recovery
      ? receipt.blockNumber >= BigInt(entry.recovery.fromBlock)
      : Number(receiptBlock.timestamp) * 1000 >= entry.createdAt - 30_000;
    if (replacementHash) {
      if (operation) {
        // A bundle's transaction nonce belongs to its bundler; only timing bounds attribution.
        if (!afterAttempt) throw new Error("wrongReplacement");
      } else if (!direct) throw new Error("wrongReplacement");
      else if (originalNonce !== undefined) {
        if (tx.nonce !== originalNonce) throw new Error("wrongReplacement");
      } else {
        // Manual attribution of a wallet-provided hash is limited to the exact intended effect.
        // Without a known original nonce, a cancellation/different call cannot prove replacement.
        if (!sameCall(entry, tx) || tx.nonce < entry.nonce || !afterAttempt)
          throw new Error("wrongReplacement");
      }
    }
    const head = await c.getBlockNumber();
    if (
      head < receipt.blockNumber + 1n ||
      receiptBlock.hash !== receipt.blockHash
    )
      throw new Error("staleChain");
    if (!operation) {
      if (!direct) throw new Error("wrongReplacement");
      if (
        !sameCall(entry, tx) &&
        (originalNonce === undefined || tx.nonce !== originalNonce)
      )
        throw new Error("wrongReplacement");
    }
    const call = operation?.call ?? tx;
    const logs = operation?.logs ?? receipt.logs;
    const state = operation
      ? operation.success
        ? "confirmed"
        : "reverted"
      : !sameCall(entry, tx)
        ? "replaced"
        : receipt.status === "success"
          ? "confirmed"
          : "reverted";
    await write({
      ...entry,
      hash,
      ...(operation ? {} : { nonce: tx.nonce, nonceConfirmed: true }),
      status: state,
      ...(state === "confirmed" && entry.kind === "purchase" && entry.purchase
        ? {
            purchaseReceipt: purchaseReceipt(
              logs,
              restorePurchase(entry.purchase)!,
            ),
          }
        : {}),
      ...(state === "confirmed" && entry.kind === "claim"
        ? { claimReceipt: claimReceipt(logs, entry.account) }
        : {}),
    });
    if (state === "confirmed" && entry.kind === "claim") {
      // A successful exact claim proves the tickets were paid once. A lost retry
      // may have reverted without an event; retain that uncertain attempt without
      // describing its own transaction as confirmed or blocking later purchases.
      for (const related of journals()) {
        if (
          related.id !== entry.id &&
          related.kind === "claim" &&
          related.chainId === entry.chainId &&
          related.account.toLowerCase() === entry.account.toLowerCase() &&
          !related.hash &&
          UNRESOLVED.has(related.status) &&
          sameCall(related, call)
        )
          await write({ ...related, status: "superseded", resolvedBy: hash });
      }
    }
  };
  return entry.chainId === 1
    ? atEvmEndpoint(1, urls, inspect)
    : atNativeEndpoint(urls, inspect, signal);
}

/** A lost response has no trustworthy hash or wallet-selected nonce. Find candidates without
 * treating an unrelated same-account call as proof, and never clear/resubmit automatically. */
export async function findTransactionCandidates(
  urls: string[],
  entry: Journal,
  signal?: AbortSignal,
): Promise<void> {
  if (
    entry.hash ||
    !(
      entry.kind === "claim" ||
      (entry.kind === "purchase" && entry.purchase)
    ) ||
    entry.chainId !== 8453 ||
    entry.to.toLowerCase() !== JACKPOT.toLowerCase() ||
    !entry.recovery
  )
    return;
  await atNativeEndpoint(
    urls,
    async (c) => {
      const head = await c.getBlockNumber(),
        from = BigInt(entry.recovery!.nextBlock);
      if (head < from + 1n) return;
      let to = from + 1999n < head - 1n ? from + 1999n : head - 1n;
      const readLogs = () =>
        entry.kind === "claim"
          ? c.getContractEvents({
              address: JACKPOT,
              abi: jackpotAbi,
              eventName: "TicketWinningsClaimed",
              args: { userAddress: entry.account },
              fromBlock: from,
              toBlock: to,
              strict: true,
            })
          : c.getContractEvents({
              address: JACKPOT,
              abi: jackpotAbi,
              eventName: "TicketOrderProcessed",
              args: { buyer: entry.account, recipient: entry.account },
              fromBlock: from,
              toBlock: to,
              strict: true,
            });
      let hashes: Hex[] = [];
      // At most eleven range probes and five distinct transaction lookups.
      // Multiple ticket events from one claim consume only one lookup.
      for (let probe = 0; probe < 11; probe++) {
        hashes = [
          ...new Set((await readLogs()).map((log) => log.transactionHash)),
        ];
        if (hashes.length <= 5) break;
        if (to === from) return; // Exceptional same-block volume retains manual recovery.
        to = from + (to - from) / 2n;
      }
      if (hashes.length > 5) return;
      const candidates = new Set(entry.recovery!.candidates);
      for (const hash of hashes) {
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
    },
    signal,
  );
}

/** Rotate bounded recovery work so old silent approvals cannot starve receipts. */
export function recoveryBatch(
  items: Journal[],
  after?: string,
  limit = 5,
): Journal[] {
  const eligible = items.filter(
    (e) =>
      e.chainId === 8453 &&
      UNRESOLVED.has(e.status) &&
      (e.hash ||
        (e.recovery &&
          (e.kind === "claim" || (e.kind === "purchase" && e.purchase)))),
  );
  const start =
    Math.max(0, eligible.findIndex((e) => e.id === after) + 1) %
    (eligible.length || 1);
  return [...eligible.slice(start), ...eligible.slice(0, start)].slice(
    0,
    limit,
  );
}

/** Receipt polling is mounted once by the shell and never invokes the wallet. */
export function recoveryDue(
  items: Journal[],
  account: string | null | undefined,
  checked: ReadonlyMap<string, number>,
  now = Date.now(),
) {
  if (!account) return [];
  return items.filter((entry) => {
    if (entry.account.toLowerCase() !== account.toLowerCase()) return false;
    const interval =
      now - entry.createdAt > 600_000 ? 300_000 : entry.hash ? 15_000 : 60_000;
    const last = checked.get(`${entry.id}:${entry.hash ?? ""}`);
    return last === undefined || now - last >= interval;
  });
}

export function useTransactionRecovery(
  urls: string[],
  account?: string | null,
  ready = true,
) {
  const items = useTransactions();
  const cursor = useRef<string | undefined>(undefined);
  const checked = useRef(new Map<string, number>());
  const candidates = useRef(new Map<string, number>());
  const pending = recoveryBatch(
    recoveryDue(items, account, new Map()),
    undefined,
    1,
  );
  useQuery({
    // Journal writes must not create overlapping observers or restart a scan.
    queryKey: ["transaction-recovery", urls, account?.toLowerCase() ?? null],
    enabled: ready && pending.length > 0,
    queryFn: async ({ signal }) => {
      if (!account || document.hidden) return Date.now();
      const current = journals();
      const retained = new Set(current.map((e) => `${e.id}:${e.hash ?? ""}`));
      for (const key of checked.current.keys())
        if (!retained.has(key)) checked.current.delete(key);
      for (const key of candidates.current.keys())
        if (!current.some((e) => e.id === key)) candidates.current.delete(key);
      for (const entry of recoveryBatch(
        recoveryDue(current, account, checked.current),
        cursor.current,
        1,
      )) {
        signal.throwIfAborted();
        cursor.current = entry.id;
        checked.current.set(`${entry.id}:${entry.hash ?? ""}`, Date.now());
        if (entry.hash)
          await reconcile(urls, entry, undefined, signal).catch(() => {});
        else {
          if (!entry.recovery?.candidates.length)
            await findTransactionCandidates(urls, entry, signal).catch(
              () => {},
            );
          signal.throwIfAborted();
          const latest = journals().find((j) => j.id === entry.id);
          if (!latest || !UNRESOLVED.has(latest.status)) continue;
          const hashes = latest.recovery?.candidates ?? [];
          if (hashes.length) {
            const index = candidates.current.get(entry.id) ?? 0;
            candidates.current.set(entry.id, index + 1);
            await reconcile(
              urls,
              latest,
              hashes[index % hashes.length],
              signal,
            ).catch(() => {});
          }
        }
      }
      return Date.now();
    },
    staleTime: 12_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}

/** Stop waiting in this view without cancelling or losing the wallet's eventual result. */
function awaitWalletResult<T>(
  result: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return result;
  // An already-aborted caller must still observe rejection of detached work.
  void result.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("reviewCancelled"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    result
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

async function dispatchWallet(
  entry: Journal,
  provider: WalletProvider,
  revision: number,
  request: RpcTransactionRequest & { chainId: Hex },
  signal?: AbortSignal,
) {
  return navigator.locks.request("megapot-club:journal-write", async () => {
    if (
      (await assertWalletTarget(entry.account, revision, entry.chainId)) !==
      provider
    )
      throw new Error("walletChanged");
    if (signal?.aborted) throw new Error("reviewCancelled");
    const entries = journals();
    const reservation = entries.find((j) => j.id === entry.id);
    if (
      !reservation ||
      reservation.status !== "wallet" ||
      reservation.hash ||
      !journalStorageAvailable()
    )
      throw new Error("trackingUnavailable");
    // No await separates eligibility from handing off the exact target-bound call.
    let response: Promise<unknown>;
    try {
      response = Promise.resolve(
        provider.request({
          method: "eth_sendTransaction",
          params: [request],
        }),
      );
    } catch (error) {
      response = Promise.reject(error);
    }
    void response.catch(() => {});
    return { response };
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
  onWalletRequest?: () => void,
): Promise<Journal> {
  const run = async () => {
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
    if (signal?.aborted) throw new Error("reviewCancelled");
    if (
      (await prepareWalletTarget(
        review.account,
        walletRevision,
        8453,
        urls,
        onWalletRequest,
        signal,
      )) !== w
    )
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
    const previous = [...journals()].reverse().find(
      (j) =>
        j.account.toLowerCase() === entry.account.toLowerCase() &&
        j.chainId === entry.chainId &&
        UNRESOLVED.has(j.status) &&
        sameCall(j, {
          to: entry.to,
          input: entry.data!,
          value: BigInt(entry.value ?? "0"),
        }),
    );
    if (previous) entry.retryOf = previous.id;
    let handoff: { response: Promise<unknown> };
    try {
      await write(entry, true);
      handoff = await dispatchWallet(
        entry,
        w,
        walletRevision,
        {
          from: entry.account,
          to: entry.to,
          data: call.data,
          value: toHex(call.value),
          chainId: toHex(entry.chainId),
          gas: toHex(gas + gas / 5n),
        },
        signal,
      );
    } catch (error) {
      await write({ ...entry, status: "rejected" }).catch(() => {});
      throw error;
    }
    const response = (async (): Promise<Journal> => {
      try {
        const hash = await handoff.response;
        if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
          throw new Error("invalidHash");
        entry = await write(
          { ...entry, hash: hash as Hex, status: "pending" },
          false,
          true,
        );
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
        const refused = walletRequestRefused(error);
        await write({ ...entry, status: refused ? "rejected" : "unknown" });
        throw new Error(refused ? walletError(error) : "walletNoResponse");
      }
    })();
    void response.catch(() => {});
    onWalletRequest?.();
    return { response };
  };
  if (!navigator.locks) throw new Error("trackingUnavailable");
  // Wallet switches may never answer. They must not hold a cross-flow lock.
  // The journal mutex still protects durable reservation and final handoff.
  const task = await awaitWalletResult(run(), signal);
  return awaitWalletResult(task.response, signal);
}

/** Vault submission shares the native operation journal and cross-tab mutex. Recovery never resubmits. */
export async function submitVaultReview(
  urls: string[],
  review: VaultReview,
  revision: number,
  signal?: AbortSignal,
  onWalletRequest?: () => void,
): Promise<Journal> {
  const run = async () => {
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
    if (signal?.aborted) throw new Error("reviewCancelled");
    if (
      (await prepareWalletTarget(
        review.account,
        revision,
        review.chainId,
        urls,
        onWalletRequest,
        signal,
      )) !== provider
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
    const previous = [...journals()].reverse().find(
      (j) =>
        j.account.toLowerCase() === entry.account.toLowerCase() &&
        j.chainId === entry.chainId &&
        UNRESOLVED.has(j.status) &&
        sameCall(j, {
          to: entry.to,
          input: entry.data!,
          value: BigInt(entry.value ?? "0"),
        }),
    );
    if (previous) entry.retryOf = previous.id;
    let handoff: { response: Promise<unknown> };
    try {
      await write(entry, true);
      handoff = await dispatchWallet(
        entry,
        provider,
        revision,
        {
          from: entry.account,
          to: entry.to,
          data: call.data,
          value: toHex(call.value),
          chainId: toHex(entry.chainId),
          gas: toHex(gas + gas / 5n),
        },
        signal,
      );
    } catch (error) {
      await write({ ...entry, status: "rejected" }).catch(() => {});
      throw error;
    }
    const response = (async (): Promise<Journal> => {
      try {
        const hash = await handoff.response;
        if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash))
          throw new Error("invalidHash");
        entry = await write(
          { ...entry, hash: hash as Hex, status: "pending" },
          false,
          true,
        );
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
        const refused = walletRequestRefused(e);
        await write({ ...entry, status: refused ? "rejected" : "unknown" });
        throw new Error(refused ? walletError(e) : "walletNoResponse");
      }
    })();
    void response.catch(() => {});
    onWalletRequest?.();
    return { response };
  };
  if (!navigator.locks) throw new Error("trackingUnavailable");
  // Wallet switches may never answer. They must not hold a cross-flow lock.
  // The journal mutex still protects durable reservation and final handoff.
  const task = await awaitWalletResult(run(), signal);
  return awaitWalletResult(task.response, signal);
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
